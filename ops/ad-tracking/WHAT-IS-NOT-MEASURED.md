# What this setup cannot see

Written so that nobody later mistakes a gap for a bug, and so that no decision
about spend is made on the belief that these numbers are complete. They are not.
They are a floor.

## The single most important line

**The number in the database will always be higher than the number Meta and
Google report, and neither number is the revenue.** If Meta says 4 and the
database says 7, Meta is not broken and nobody is stealing leads. Ad blockers,
Safari and iOS account for the difference. Judge spend on the database count;
let Meta and Google optimise on theirs.

## Not measured at all

**Money.** No conversion carries a value. Every event is sent with `value: 0`,
deliberately. A NEXUS enquiry becomes AED 399/month months later, after a
conversation, a pilot and a signature, none of which happens in a browser. A
revenue figure guessed at enquiry time would teach Google and Meta to chase a
number that is not real. So: cost per enquiry is measurable today; cost per
paying dealership is not, by either platform.

**Offline pilot signings.** When a dealer signs, nothing flows back to Meta or
Google. The `status` column on `nexus_sales_lead` (`NEW → CONTACTED →
DEMO_BOOKED → PILOT → PAYING → LOST`) is the only place that truth exists, and
it is updated by hand. Closing that loop means offline conversion import —
Google Ads needs the stored `gclid` plus API access, Meta needs the Conversions
API plus an access token. Neither is implemented. Both are possible later
because the click ids are being stored now.

**Spam and junk cannot be un-counted.** A conversion reported to Meta or Google
is reported. Marking a row `LOST` changes nothing on either platform.

**Phone calls.** The site shows `+971 52 664 7253` as plain text. Somebody who
reads it and dials is invisible to everything here. There is no call tracking
number, and adding one is not free.

**Cross-device.** Sees the ad on a phone at work, enquires from a laptop at
home: unattributed. The landing URL that carried the click id was never the one
the form was submitted from.

**Anyone who does not click the link.** Sees the ad, searches "NEXUS auto
dealers" the next day, arrives organically. That enquiry is recorded as organic.
This is normal and it means paid channels are systematically under-credited.

## Measured, but not what it looks like

**WhatsApp.** This is the biggest asterisk, because WhatsApp is how this
business actually converts.
- A click on a `wa.me` button on this site fires `Contact`. That is **the click,
  not the conversation**. It does not mean a message was sent, read or replied
  to. WhatsApp opens in a different app and reports nothing back.
- Anyone who copies the number, or messages a number they already had saved, or
  replies to a WhatsApp ad thread directly, fires nothing.
- The WhatsApp conversation itself — the part where the deal is actually made —
  is not connected to the ad click in any way. There is no key joining a
  `wa.me` click to an inbound WhatsApp message.
- This is why `NEXUS WhatsApp click` is a **Secondary** conversion in Google Ads
  (SETUP.md step 9). Bidding on it would buy clicks on a button, not customers.

**Attribution lives for one browser session.** First touch wins, stored in
`sessionStorage`. Close the tab, return two days later organically and enquire:
the ad that paid for the visit is gone. There is no 30-day cookie and no
cross-session stitching.

**`referrer` is the site, not the page.** The response header is
`Referrer-Policy: strict-origin-when-cross-origin`, so a cross-origin referrer
arrives as an origin only. That is a deliberate privacy setting, not a defect.

**A stored `gclid` is not a keyword.** The database can prove "this row came
from a Google click". Turning that id back into which keyword, which auction and
what it cost requires the Google Ads click report or API. Free-tier answer: join
on `utm_campaign` / `utm_content`, which is campaign- and creative-level, not
click-level.

## Signal loss, by cause

| cause | effect |
|---|---|
| **iOS / App Tracking Transparency** | Meta's iOS conversions are **modelled**, not counted. Aggregated Event Measurement caps Meta at 8 events per domain and reports them with delay. Treat Meta's iOS numbers as an estimate. |
| **Safari ITP** | Client-side cookies capped at 7 days, and 24 hours when the URL was link-decorated with a click id. A Safari visitor who returns on day 3 is a new person. |
| **Ad blockers / uBlock / Brave** | `fbevents.js` and `gtag.js` are on every blocklist. Those visitors can still enquire — the form is a first-party POST to `/api/lead` and works regardless — but their conversion reaches no platform. The row is still stored, with its UTMs. |
| **Private / incognito mode** | `sessionStorage` may be unavailable. The enquiry is still stored; the attribution on it may be empty. |
| **Meta Conversions API not implemented** | The usual fix for the three rows above. Not done: it needs a server-side access token, which is a secret and does not belong in a browser. Groundwork is in place — the same `submission_id` is already sent as the Meta `eventID` and as Google's `transaction_id`, so a server-side event added later will deduplicate against the browser one instead of double-counting. |

## Deliberately not collected

No personal data is sent to Meta or Google. No name, phone number, email address
or message text — not raw, and not hashed. Meta's Automatic Advanced Matching is
off (in code and in Events Manager) and Google's Enhanced Conversions is off.
Both would improve match rates. Both were declined. The cost of that choice is
lower reported conversion counts, and it is the correct trade for a form that
collects UAE dealers' personal mobile numbers.

## State of the evidence, 17 September 2026

Verified by `SELECT` against production (`dsvuoovivysszdoiorch`,
`public.nexus_sales_lead`), counts and key names only:

- 4 rows total; 3 carry a non-empty `attribution` blob.
- The only keys that appear anywhere are `utm_source` (3 rows) and
  `utm_campaign` (1 row).
- **`fbclid`: 0 rows. `gclid`: 0 rows. `landing_path`: 0 rows.**

`landing_path` is set unconditionally by the browser on every page load, so its
absence from all four rows means **no row in production was produced by the live
browser form carrying attribution**. Those three attributed rows were posted
directly (tests or the lead simulator). The browser → `/api/lead` → database
attribution path is therefore **implemented and unit-checked, but not yet proven
in production by a real visitor**. Until a real ad click produces a row, treat
it as unproven.

Re-run this check after the first test enquiry of SETUP.md step 12:

```sql
select k as attribution_key, count(*) as rows
from public.nexus_sales_lead,
     lateral jsonb_object_keys(coalesce(attribution,'{}'::jsonb)) k
group by k order by rows desc;
```

A `gclid` or `fbclid` row appearing here is the proof that an ad click reached
the database. Nothing before that is proof.
