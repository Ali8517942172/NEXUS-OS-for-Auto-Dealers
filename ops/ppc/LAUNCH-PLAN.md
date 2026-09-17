# NEXUS OS — Paid Acquisition Launch Plan (first dirham)

Date written: 2026-09-17
Owner: Ali (founder). Executor: Ali, by hand, in the ad manager.
Status: **PLAN ONLY. Nothing in this file has been created, bought or spent.**
No ad account was touched to produce it.

---

## 0. The funnel this plan is bound to

    Ad  ->  https://nexus-for-autodealers.vercel.app/  ->  Free Dealer Audit form
        ->  NEXUS sales lead (public.nexus_sales_lead)  ->  founder replies on WhatsApp
        ->  demo  ->  30-day pilot

There is no other permitted destination. **No ad ever points at a dashboard,
a login, or an app subdomain.** The landing page is not a formality in this
funnel — it is where the honesty lives (no paying customers yet, no case
studies, AED 399, first month free). An ad that skips it is an ad that has to
make those claims itself, and we will not write those claims.

---

## 1. Platform order: **Meta first. Google second, and not yet.**

### The argument for Google first (stated fairly, then rejected)

Google Search is demand *capture*. A dealer who types "dealership CRM Dubai"
has already decided they have a problem, which makes them a better lead than
anyone scrolling Instagram. Intent is real and it is worth paying for.

### Why it still loses at this budget

1. **The demand is not there to capture.** A used-car showroom owner in Deira
   does not search for "AI operating system for dealerships" — that category
   does not exist in his head. The searches that do exist in the UAE for
   "car dealer Dubai", "used cars Sharjah" and similar are dominated by
   *car buyers*, and broad or phrase match will spend the entire budget on
   consumers looking for a Land Cruiser. The keywords that would be genuinely
   right ("dealership lead management software UAE") have so little volume that
   at AED 25–40/day the campaign will show a handful of impressions a day and
   teach us nothing for a fortnight.
2. **Arithmetic.** UAE Search CPC is reported at AED 4–65, with most service
   businesses at AED 6–18 and small-audience B2B niches at AED 4–10
   ([mshahid.com, "Google Ads Cost in the UAE: 2026 CPC Guide by Industry"](https://mshahid.com/blog/google-ads-cost-uae) —
   an agency blog, not a primary source; treat as an order-of-magnitude, not a
   fact). At AED 40/day and AED 8/click that is 5 clicks a day. Five clicks a
   day cannot separate a good ad from a bad one before the money is gone.
3. **The site cannot measure Google today.** `apps/marketing-site/index.html`
   contains a Meta Pixel loader and fires `fbq('track','Lead')` on a 200 from
   the form. It contains **no gtag, no Google Ads conversion tag, no GTM**
   (verified by grep, 2026-09-17). Google would require a code change and a
   Vercel deploy *before* the first click. Meta requires one string pasted into
   an existing `<meta>` tag.
4. **Meta can find the person who isn't looking.** Geography plus
   business-owner behaviour plus Page-admin signals reaches a showroom owner who
   has never searched for us. At the stage where the product has one pilot and
   no customers, the job is not to win an auction — it is to find out whether
   any dealer will give up five answers for a free audit. Meta answers that
   question cheaper and faster.

### When Google turns on

Only after Meta has produced **at least 3 completed audit forms**, and only as
two small campaigns: (a) brand defence on "NEXUS for AutoDealers" and
misspellings, (b) a 10–14 keyword exact/phrase category list. Spec is in §8 so
it is ready when the trigger fires. Do not run it before.

### Not TikTok, not LinkedIn, not yet

- **LinkedIn** would target the job title perfectly and costs USD 8–15 a click.
  At AED 40/day that is 1 click a day. Correct audience, wrong budget.
- **TikTok** reaches the right age bracket in the UAE cheaply but needs video
  we do not have, and the buying context is wrong for a B2B subscription.
- Revisit both only after a paying customer exists.

---

## 2. Which Facebook Page the ads run from

**Run from the "Adqonic" Page.** Business portfolio: Adqonic
(business_id `1414977205987811`).

Why:

- It is a **business** Page inside the portfolio that owns the ad account, so
  the Page role, ad account and payment method all sit under one business.
  That is the boring, reviewable shape Meta expects, and it avoids the
  "personal Page running commercial ads" pattern that gets extra scrutiny.
- Running from **"Ali Asgher Ujjain Wala"** would make a B2B software ad look
  like a personal solicitation. A dealer GM who is deciding whether to hand
  over his WhatsApp number will click the advertiser's name. A personal profile
  Page at the other end reads as a freelancer, and it is the cheapest possible
  way to lose a lead we already paid for.
- **There is no ALBA CARS Page and we must not create the impression of one.**
  ALBA Cars is tenant #1, the pilot, not the vendor and not a customer
  reference. ALBA's name, logo or premises must not appear in any ad, image,
  caption or Page identity. Advertising from an "ALBA" identity would tell a
  competing dealer that a rival showroom is selling him software — which is
  both untrue and commercially fatal.

**The catch Ali must accept before launch.** The Adqonic Page must not be
empty when the ads start. A brand-new Page with no profile image, no
description, no website link and zero posts is (a) more likely to be flagged
in ad review, and (b) the thing a skeptical buyer checks first. Budget 20
minutes for: profile image, cover, one-line description naming NEXUS for
AutoDealers, website link to the landing page, and 2–3 posts. This is not
optional polish; it is part of the funnel.

---

## 3. Campaign objective and structure

| | |
|---|---|
| **Objective** | **Traffic**, conversion location **Website**, optimising for **Landing page views** |
| **Buying type** | Auction |
| **Campaign budget** | Ad-set level budget (not CBO) — one ad set, so CBO adds nothing but a layer |
| **Attribution setting** | 7-day click, 1-day view (default) |
| **Structure** | 1 campaign -> 1 ad set -> 3 ads |

### Why not the Leads objective with Lead optimisation

Meta's conversion optimiser needs roughly **50 optimisation events per ad set
per week** to exit the learning phase. At AED 40/day a realistic cost per
completed audit form is somewhere in the AED 80–300 range, which is 1–3 a week.
The optimiser would sit in learning forever, spending erratically and giving us
a number we cannot read. Optimising for **landing page views** gives an event
that fires 20–80 times a week — enough for delivery to stabilise — while the
*actual* success metric is counted by us, out of the database, from the
attribution column. Switch the optimisation event to Lead only when the account
is producing 10+ form submits a week, which is a different budget than this one.

### Why not Instant Forms (on-Meta lead ads)

They would be cheaper per lead. They are ruled out for now, deliberately:

- They **bypass the landing page**, and the landing page is where the
  "one pilot, no paying customers, AED 399, no contract" disclosure lives. An
  ad that collects a phone number without showing that page is selling
  something the page refuses to sell.
- The attribution allowlist (`utm_*`, `fbclid`, `referrer`, `landing_path`) and
  the sessionStorage first-touch logic in `index.html` are built for a website
  visit. A lead-ad submission arrives through a different path entirely and
  would land in `nexus_sales_lead` with an empty `attribution` object.
- Instant-form leads are notoriously low-intent because the form is prefilled;
  at 1–3 leads a week we cannot afford leads that do not answer WhatsApp.

Revisit after the website funnel has produced a baseline cost per audit to
compare against.

---

## 4. Budget, and the stop-loss

### The numbers

| Item | Value |
|---|---|
| Daily budget | **AED 40/day** (approx. USD 11) |
| Test length | 14 days |
| **Total committed spend** | **AED 560** |
| Google | AED 0 until the §1 trigger fires |
| Account spending limit (set in Billing) | **AED 600** |

AED 40/day is comfortably above Meta's minimum for a daily budget and buys
roughly 3,000–7,000 impressions a week in this geography — enough to read a
click-through rate, which is the only thing that accumulates fast enough to
read at this size.

### The stop-loss, written before the money is spent

Set the **account spending limit to AED 600** in Billing on day 0. A rule you
have to remember at 11pm is not a stop-loss; a hard cap the platform enforces
is. Then these three rules, in order of which fires first:

1. **AED 150 cumulative, fewer than 15 link clicks** -> pause everything.
   That is a CPC above AED 10, which means either the audience cannot be
   reached at this budget or the creative is being scrolled past. Fix the ad,
   not the budget.
2. **AED 400 cumulative, 200+ landing page views, 0 form submissions** ->
   pause everything. The ads worked and the page or the offer did not. More
   spend buys the same zero. Change the page's above-fold ask before
   spending again.
3. **AED 560 cumulative** -> stop regardless, and read KILL-CRITERIA.md before
   deciding anything.

**Never raise the daily budget above AED 60 in the first 30 days**, even if it
is working. A large budget jump resets Meta's learning phase and, on a young
ad account, a sudden multiple-x spend increase is one of the patterns that
triggers a payment/compromise review.

---

## 5. Targeting spec — Meta

**Locations.** Dubai, Sharjah, Abu Dhabi. Optionally add Ajman.
Set the dropdown to **"People living in this location"**, not "People recently
in this location" — the default includes tourists and transiting travellers,
who are worthless here and are a meaningful share of UAE Meta reach.

**Age.** 28–60. **Gender.** All.

**Languages.** Leave **blank** for week 1. The addressable pool (UAE used-car
dealership owners and GMs) is small; a language filter on top of an interest
filter can shrink delivery to nothing. Arabic is handled by *creative*, not by
targeting — see the Arabic ads in AD-COPY.md and the week-2 plan below.

**Detailed targeting.** Layer these with OR inside the box (Meta unions them):

- Behaviours -> Digital activities -> **Facebook Page admins**
- Behaviours -> **Small business owners**
- Job titles -> **Owner**, **General Manager**, **Managing Director**
- Interests -> **Car dealership**, **Used car**, **Automotive industry**
- Industries -> **Sales** (only if the audience estimate is below ~40,000)

**Advantage detailed targeting: OFF.** Left on, Meta treats the interests as a
suggestion and expands to everyone in the UAE. At AED 40/day that expansion
will eat the entire budget on people who will never buy.

**Advantage+ audience: OFF** for week 1, for the same reason.

**Honest note on audience size.** There are on the order of a few thousand
used-car showrooms in the UAE. The audience Meta reports will be 50,000–400,000
because interest targeting is loose. **Targeting is the coarse filter; the ad
copy is the real filter.** Every headline in AD-COPY.md names the reader's
situation in the first line so the wrong people self-deselect before they
cost us a click.

**Custom audiences.** None on day 1 (there is no list). From day 1 the pixel
starts building a website custom audience — do not spend on retargeting until
that audience reaches ~300 people, which at this budget is roughly week 3.

### Placements

**Manual placements. Facebook Feed + Instagram Feed only.**

- **Audience Network: OFF.** It buys the cheapest clicks in the world and
  almost none of them are a dealer owner.
- **Reels / Stories: OFF for week 1** — we have static images, and a static
  image in a Reels slot delivers badly and pollutes the CTR read.
- Revisit Stories in week 2 only if we have a vertical creative.

Two placements keeps the signal readable. At AED 560 total, the goal is one
clean number per ad, not maximum surface area.

### Schedule

Run continuously. Do not day-part at this budget — dayparting a AED 40/day
budget concentrates spend into hours with thinner auctions and gives Meta less
to learn from. (Note the irony and keep it: the product's own pitch is that
enquiries arrive at night. So do ad impressions.)

---

## 6. Naming convention and UTMs

The attribution allowlist is fixed in two places and must be matched exactly:
`apps/marketing-site/index.html` (client, first-touch, sessionStorage) and
`apps/marketing-site/api/lead.js` (server, `ATTRIBUTION_KEYS`). The permitted
keys are:

    utm_source  utm_medium  utm_campaign  utm_content  utm_term
    fbclid      gclid       ttclid        referrer     landing_path

Anything else in the query string is **silently dropped by the server**. Do not
invent `utm_adset`, `utm_id`, `campaign_id` or `ad_id` — they will not be
stored and the spend will be unjudgeable. Each value is truncated at **200
characters**, so names must be short.

### Naming formula

    Campaign :  NX-<GEO>-<OFFER>-<PLATFORM>-<STAGE>-<YYYYMM>
    Ad set   :  <GEO>-<AUDIENCE>-<OPTIMISATION>-<AGE>
    Ad       :  <ANGLE>-<FORMAT>-<LANG>-v<N>

Rules: UPPER-CASE, hyphens only. **No spaces, no `&`, no `+`, no `/`, no
commas** — these names are injected into a URL by Meta's dynamic parameters and
a space becomes `%20` in the stored attribution value.

### Week 1, exactly

| Level | Name |
|---|---|
| Campaign | `NX-UAE-AUDIT-META-PROSPECT-202609` |
| Ad set | `DXB-SHJ-AUH-OWNERS-LPV-A28-60` |
| Ad 1 | `MIDNIGHT-IMG-EN-v1` |
| Ad 2 | `FIRSTREPLY-IMG-EN-v1` |
| Ad 3 | `HONEST-IMG-EN-v1` |
| Ad 4 (week 2) | `MIDNIGHT-IMG-AR-v1` |
| Ad 5 (week 2) | `HONEST-IMG-AR-v1` |

### The exact tracking string to paste

In the ad's **Tracking -> URL parameters** field (not appended to the Website
URL — keep that field clean so the destination is obvious in review):

    utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}

Website URL field:

    https://nexus-for-autodealers.vercel.app/

What lands in the database for a click on Ad 1 from Instagram:

| key | value |
|---|---|
| `utm_source` | `ig` (Meta fills `fb`, `ig`, `an` or `msg`) |
| `utm_medium` | `paid_social` |
| `utm_campaign` | `NX-UAE-AUDIT-META-PROSPECT-202609` |
| `utm_content` | `MIDNIGHT-IMG-EN-v1` |
| `utm_term` | `DXB-SHJ-AUH-OWNERS-LPV-A28-60` |
| `fbclid` | appended automatically by Meta, already allowlisted |
| `landing_path` | `/` (set by the page, not the ad) |

`utm_content` is the field that answers "which ad earned this". Guard it.

### Reading the result

Every submission lands in `public.nexus_sales_lead` with an `attribution` jsonb
column. **The notification webhook body does NOT include attribution**
(`api/lead.js` sends only the seven allowlisted contact fields to n8n), so the
email or WhatsApp alert will not tell you which ad produced the lead. Read it
from the database:

```sql
select received_at,
       dealership,
       stock_size,
       attribution->>'utm_source'   as src,
       attribution->>'utm_campaign' as campaign,
       attribution->>'utm_content'  as ad,
       attribution->>'utm_term'     as adset
from public.nexus_sales_lead
where received_at > now() - interval '14 days'
order by received_at desc;
```

An audit request arriving with an empty `attribution` object is an organic
visitor, not a paid one. Do not credit it to the campaign.

---

## 7. Launch checklist (under an hour, in this order)

0. Set the **Meta Pixel ID** in `apps/marketing-site/index.html`
   (`<meta name="nexus:meta-pixel-id" content="">` is currently **empty**, so
   the site loads no pixel and fires no `Lead` event) and deploy. Without this
   there is no conversion data, no retargeting audience, and no route to
   conversion optimisation later. **This is a code change and a deploy; it
   happens before any spend.**
1. Furnish the Adqonic Page: image, description, website link, 2–3 posts.
2. Confirm the ad account is inside the Adqonic business portfolio and has a
   valid payment method.
3. **Billing -> set account spending limit AED 600.**
4. Create campaign `NX-UAE-AUDIT-META-PROSPECT-202609`, objective Traffic.
5. Create ad set `DXB-SHJ-AUH-OWNERS-LPV-A28-60` per §5. Budget AED 40/day.
   Optimisation: Landing page views. Advantage expansions OFF. Manual
   placements: FB Feed + IG Feed.
6. Create the three English ads from AD-COPY.md. Paste the URL parameters
   string into each.
7. **Click the preview link on each ad, on a phone, and confirm the URL
   arriving at the landing page carries the utm parameters.** Submit one test
   form yourself and check the row appears in `nexus_sales_lead` with
   `attribution` populated. If it does not, the campaign is unjudgeable —
   fix it before publishing.
8. Publish. Do not touch anything for 72 hours.

---

## 8. Google Ads spec — HELD, do not build until §1 trigger fires

Written now so it takes 20 minutes later, not an afternoon.

**Prerequisite (blocking):** a Google Ads conversion tag must be added to
`index.html` and fired on the same 200 branch as `fbq('track','Lead')`. There
is no Google tag on the site today.

| | |
|---|---|
| Campaign | `NX-UAE-AUDIT-GSE-CATEGORY-202610` |
| Type | Search only. **Display network OFF, search partners OFF.** |
| Bidding | Manual CPC with enhanced CPC, or Maximise Clicks with a **CPC cap of AED 12**. Never tCPA — there is no conversion history to target against. |
| Budget | AED 25/day |
| Locations | UAE — "Presence: people in or regularly in" (not "interested in") |
| Languages | English + Arabic |
| Match types | Exact and phrase only. **No broad match.** |
| Negatives (day 0) | `for sale`, `buy`, `rent`, `price`, `used cars`, `cheap`, `job`, `jobs`, `salary`, `careers`, `free download`, `course`, `training`, `crack` |

Seed keywords (exact/phrase, 10–14 max):
`[dealership crm uae]`, `[car dealership software dubai]`,
`[used car dealer software uae]`, `[dealer management system dubai]`,
`"lead management software for car dealers"`,
`"whatsapp crm for car dealership"`, `"showroom crm dubai"`,
`"automotive crm uae"`

Campaign-level **Final URL suffix**:

    utm_source=google&utm_medium=cpc&utm_campaign=NX-UAE-AUDIT-GSE-CATEGORY-202610&utm_term={keyword}&utm_content={creative}

Leave Google auto-tagging **on** — `gclid` is already in the allowlist and is
the reliable identifier; the UTMs are the human-readable backup.

---

## 9. What this plan deliberately does not claim

- No forecast of leads, cost per lead, or revenue. We have never run a paid
  campaign for this product; any number here would be invented, and the
  landing page's whole argument is that we do not invent numbers.
- The CPC and CPA ranges cited in §1 come from a named third-party agency blog
  and are labelled as such. They size the decision; they do not predict our
  result.
- AED 560 is a price for information, not an investment with an expected
  return. The information it buys is: *will a UAE dealer give up five answers
  for a free audit?* If the answer is no, that is worth knowing for AED 560.

---

## DECIDED — 17 September 2026, by Ali

**Meta Page: run from the "Adqonic" Page** (business portfolio `Adqonic`,
`business_id 1414977205987811`). There is **no ALBA CARS Page** in the Business
Manager and NEXUS has no Page of its own, so this was the only option that lets
spend start today.

Two consequences to hold in mind, because they are real and not cosmetic:

1. A dealer who clicks the Page name lands on a **marketing agency**, not on
   NEXUS. The ad copy must therefore carry the product name itself and not rely
   on the Page for identity, and the landing page has to finish the introduction
   the Page did not make.
2. Every follower, review and piece of social proof this spend generates accrues
   to **Adqonic**, not to NEXUS. That is a cost paid quietly. The moment NEXUS
   has its own Page, move the spend and accept that the social proof does not
   move with it.

**Offer on the page the ads point at (decided 17 September 2026): AED 399/month,
first month free, no setup fee, no minimum term.** Flat and permanent — there is
no cap on the number of dealerships, no deadline, and no expiring rate. The ads
may state the price and the free first month, because both are published and
both are true.

The ads may **NOT** state a result, because no dealer has produced one, and they
may **NOT** use scarcity of any kind — no "only 10 places", no "until 31 October",
no countdown, no "founding rate ends soon". An earlier version of this plan told
ads to run a cap and a deadline. **That cap and that deadline no longer exist**, so
stating them would be false urgency: a Meta Advertising Standards problem
(see `POLICY-RISK.md`) and, more simply, a lie. The urgency in this funnel comes
from the dealer's own unanswered enquiries, never from an invented clock.
