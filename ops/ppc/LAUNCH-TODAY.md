# NEXUS OS — LAUNCH TODAY: the hour that turns the plan into clicks

Date written: 2026-09-17
Owner and sole executor: **Ali.** Every action below is done by Ali's own hands
in his own accounts.

**Status of this file: EXECUTION PACK. Nothing in it has been created, bought,
submitted or spent.** No ad account, Page, pixel or billing setting was touched
to produce it. No form was submitted. Producing it cost AED 0.

**What this file is.** `LAUNCH-PLAN.md` decided *what* to run and *why*.
`AD-COPY.md` wrote the words. `KILL-CRITERIA.md` wrote the stop rules.
`POLICY-RISK.md` wrote what would get the account restricted. This file is the
one that sits open on the second monitor while you click. It repeats those
decisions only where you need the value in your hand; it does not re-argue them.

**Read §0 before anything.** Four things in the existing ops files are wrong or
out of date against the code that is actually deployed, and two of them would
make the spend unjudgeable or put the ad out of step with its own landing page.

---

## 0. Four corrections to the existing files — read first, they change what you type

Each was verified against the repository and against the live site on
**17 September 2026**.

### 0.1 The form asks FOUR questions, not five. Every ad in `AD-COPY.md` says five.

`apps/marketing-site/index.html` collects exactly four fields:
`full_name`, `dealership`, `phone`, and `stock_size` (which is itself marked
optional). **There is no `message` field on the form** — verified by grep on the
repository and by `curl` on the live page, which returns zero matches for
`name="message"`.

`api/lead.js` line 143 accepts a `message` and passes it through, but nothing
on the page ever sends one. So the field exists on the server and not in the
form.

Two things break because of this:

1. **Six ads in `AD-COPY.md` and both Arabic variants promise "five questions",
   and Ad 7 enumerates them, ending with "the one thing costing you most right
   now" — a question the form does not ask.** Meta's review explicitly checks
   that the ad and the landing page say the same thing (`POLICY-RISK.md` §3).
   This is a small inconsistency, but it is one we wrote ourselves, and it is
   the kind that a reviewer or a skeptical dealer notices.
2. **`KILL-CRITERIA.md` §2, item 3 tells you to read "the free text in the form"
   as the single most valuable output of the whole test.** That diagnostic
   cannot run. There is no free text.

**What to do — pick one, today:**

- **Fix A (recommended, ~5 minutes, same deploy as the pixel).** Add the missing
  textarea to the form so it posts `message`, and the ads become true as written
  *and* you get back the diagnostic `KILL-CRITERIA` says is worth more than the
  entire click dataset. You are already editing and deploying `index.html` for
  the pixel (§2), so this costs one extra edit and no extra deploy. Label it
  exactly as the copy promises: *"What is costing you most right now — optional"*.
- **Fix B (zero code).** Change every "five questions" to **"four questions"**.
  The copy in §4 of this file is already written that way, so if you do nothing
  else, §4 is safe to paste as-is.

**§4 of this file uses "four questions" throughout.** If you do Fix A before you
publish, change the four back to five in all three English ads and the Arabic
one — and only then.

### 0.2 `LAUNCH-PLAN.md` §6 lists the wrong attribution allowlist, and forbids a key that works

`LAUNCH-PLAN.md` §6 states the permitted keys are
`utm_source utm_medium utm_campaign utm_content utm_term fbclid gclid ttclid
referrer landing_path`, and says in bold: *"Do not invent `utm_adset`, `utm_id`,
`campaign_id` or `ad_id` — they will not be stored."*

**That is out of date.** The allowlist actually deployed in
`apps/marketing-site/api/lead.js` (lines 158–160) is:

```js
const ATTRIBUTION_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
                          'utm_term', 'utm_id', 'fbclid', 'gclid', 'wbraid', 'gbraid',
                          'ttclid', 'referrer', 'landing_path'];
```

`utm_id`, `wbraid` and `gbraid` **are** on it, in both the server list above and
the matching `KEYS` array in `index.html` (line 686). The code comment on line
162 says it outright: *"utm_id is what Meta's dynamic URL parameters fill with
the ad id."*

So **use `utm_id={{ad.id}}`.** It is the only identifier in the string that
survives you renaming an ad, and renaming ads is the first thing you will want
to do in week two. `ops/ad-tracking/SETUP.md` step 5 already had this right;
`LAUNCH-PLAN.md` §6 did not. The string in §3.7 below is the correct one.

`utm_adset`, `campaign_id` and `ad_id` are still genuinely dropped. That part of
the warning stands.

### 0.3 The two files disagree about the campaign objective. Use Traffic.

`LAUNCH-PLAN.md` §3 says **Traffic**, performance goal **landing page views**.
`ops/ad-tracking/SETUP.md` step 6 says objective **Leads**, conversion event
**Lead**.

**Traffic wins today, and `SETUP.md` step 6 actually concedes why in its own last
sentence:** *"Until step 4 has actually recorded a Lead, `Lead` will not be
selectable in this dropdown."* Your pixel has never fired a Lead, because your
pixel does not exist yet. The Leads objective is therefore not merely unwise at
AED 40/day (the argument in `LAUNCH-PLAN` §3 — roughly 50 optimisation events a
week are needed to leave the learning phase, and this budget buys 1–3 form
submits a week), it is **not selectable**.

`SETUP.md` step 6 describes the configuration for a later month, not for today.
Treat it as the target state, not as step 6 of today's sequence.

### 0.4 `utm_source`: use the macro, not the literal

`SETUP.md` step 5 hard-codes `utm_source=meta`. `LAUNCH-PLAN.md` §6 uses
`{{site_source_name}}`. **Use `{{site_source_name}}`** — Meta fills it with
`fb`, `ig`, `an` or `msg`, which tells you whether Facebook Feed or Instagram
Feed produced the lead. `meta` tells you something you already knew.

---

## 1. Pre-flight — eight yes/no checks, none longer than a minute

Do these in order. **Any single "no" stops the launch** until its fix is done.
Nothing here costs money. Tick them in this file.

| # | The check | How to answer it in under a minute | If the answer is NO |
|---|---|---|---|
| 1 | **The Adqonic Page exists and is published** | Open `facebook.com/pages` (or Meta Business Suite → Pages) while logged in as Ali. The Adqonic Page is listed, and opening it in a logged-out browser window renders it. | If it exists but is unpublished: Page → Settings → Privacy → Page visibility → **Page published**. There is no fix that creates a Page for you and none that makes an unpublished Page servable. |
| 2 | **The Adqonic Page is furnished** | Look at it as a stranger would. It needs: profile image, cover image, a one-line description that names **NEXUS for AutoDealers**, the website link `https://nexus-for-autodealers.vercel.app/`, and **2–3 posts**. | Spend the 20 minutes. This is not polish. A Page with no image, no description and zero posts is a documented spam pattern (`POLICY-RISK.md` §5) — higher review scrutiny, and it is the first thing a dealer checks before handing over a WhatsApp number. |
| 3 | **An ad account exists, inside the Adqonic business portfolio** | Business Settings (`business.facebook.com/settings`) for portfolio `1414977205987811` → **Accounts → Ad accounts**. The account is listed there, not merely in your personal Ads Manager. | If it exists but sits outside the portfolio, add it there (Business Settings → Ad accounts → Add). If none exists, create one **inside the portfolio**. Do not create a second portfolio, ever (`POLICY-RISK.md` §5). |
| 4 | **The ad account has a valid payment method, and it is the business's** | Ads Manager → **Billing & payments → Payment settings**. There is a card with a future expiry and no red banner. | Add one. Use the business's own payment method — a card that does not match the business is a flag (`POLICY-RISK.md` §5). **Only Ali can do this.** |
| 5 | **Business verification state is known** | Business Settings → **Security Centre**. It says Verified, Pending, or not started. | **You do not have to be verified to spend today.** Unverified limits ad volume and some objectives and blocks some appeal routes. If it is not started, start it today and **launch anyway** — verification takes days and is not a gate on a AED 40/day Traffic campaign. If it says *Pending*, do nothing; a resubmission restarts the clock. |
| 6 | **A Meta Pixel exists and you can read its ID** | Events Manager → **Data sources**. A pixel is listed and its **Settings** page shows a **Dataset ID** of 15–16 digits. | Create it — full click path in §2.1. Two minutes. |
| 7 | **The landing page is live and loads on a phone on mobile data** | On your phone, **off wifi**, open `https://nexus-for-autodealers.vercel.app/`. It renders, the hero text is readable, the price is findable. (Verified from here at 17 Sep 2026: HTTP **200**, ~0.6s.) | If it does not load, stop. Everything downstream is a click you paid for and threw away. |
| 8 | **The form submits, end to end, into the database** | Submit one real test enquiry on that page with your own name and number. Then run the SQL in §5.3. A row must appear in `public.nexus_sales_lead`. | If no row appears, stop and fix it. `KILL-CRITERIA.md` §4 is blunt about this: until a submission reaches the database, the spend cannot be judged at all. |

**Two more that are not checks but settings, and both must be done before publish:**

- **Automatic Advanced Matching OFF.** Events Manager → your pixel → Settings →
  **Automatic advanced matching** → **off**. Left on, Meta reads the name and
  phone number out of the form and sends them hashed to Meta. The page disables
  it in code (`fbq('set','autoConfig',false,PIXEL)` — `index.html` line ~336),
  but the account-side toggle is what Meta honours over time. The privacy policy
  says this does not happen. Keep that true.
- **Account spending limit AED 600.** Billing & payments → **Payment settings →
  Account spending limit → Set limit → 600**. A cap the platform enforces is a
  stop-loss. A rule you have to remember at 11pm is not.

---

## 2. The Pixel — create it, read it, paste it, prove it

### 2.1 Create the pixel and read its ID

Events Manager (`business.facebook.com/events_manager`), with the Adqonic
portfolio selected:

1. **Data sources → Connect data sources**
2. **Web → Connect**
3. Name it `NEXUS site`
4. Website URL: `nexus-for-autodealers.vercel.app`
5. Choose **Install code manually**. **Do not** accept the Partner Integration
   and **do not** accept any automatic install — either one installs a second
   pixel on top of the one the page already loads, and you will spend a week
   wondering why every event is doubled.
6. When it offers you the base code, **close it**. The page already contains the
   loader. You need one thing from this screen: the number.
7. **Data sources → NEXUS site → Settings.** The field is labelled **Dataset ID**
   (Meta renamed Pixel ID to Dataset ID; it is the same number). **15–16 digits.**
   Copy it.

### 2.2 Exactly where that number goes

File: **`apps/marketing-site/index.html`**, line **307**. The tag is:

```html
<meta name="nexus:meta-pixel-id" content="">
```

Paste the digits between the quotes and change nothing else on the line:

```html
<meta name="nexus:meta-pixel-id" content="1234567890123456">
```

**The regex it must satisfy** — from `index.html` line 319, this is the real
line of code, not a paraphrase:

```js
var PIXEL = cfg('nexus:meta-pixel-id', /^[0-9]{6,20}$/);
```

So: **digits only, 6 to 20 of them.** No spaces, no quotes inside the value, no
`fb-` prefix, no trailing comma. The loader treats a malformed value **exactly
like an unset one** — the comment on that line says `/* malformed is treated
exactly like unset */`. It fails silently and completely: no script, no cookie,
no network call, no error in the console. **A typo here does not break the page.
It just quietly buys you a fortnight of unmeasurable clicks.**

Then deploy. This is a code change and a deploy and it happens **before any
spend**, because a pixel added afterwards cannot retroactively see the clicks
you already paid for.

If you are doing **Fix A** from §0.1, make that edit in the same commit and the
same deploy.

### 2.3 Prove the `Lead` event actually fires

Do not skip this. Do not assume it works because the deploy went green.

1. Events Manager → **NEXUS site → Test events**.
2. Paste `https://nexus-for-autodealers.vercel.app/` into **Test browser events**
   and open it.
3. **You must see `PageView` appear within a few seconds.** If you do not: the
   pixel ID failed the regex, or the deploy has not propagated. Re-read §2.2.
4. Now **submit a real test enquiry on the page**, with your own name and number.
5. **You must see `Lead`.**

**If you see `PageView` but never `Lead`:** the form returned an error rather
than a 200. That is deliberate — `index.html` line 784 fires
`NEXUS_TRACK.lead(submissionId)` only inside the success branch, so a `Lead`
event means an enquiry that was actually stored. A Lead that fires on a failed
submission is a lie to your own optimiser. Fix the form, not the tracking.

**Do not** try to select `Lead` as a conversion event in the campaign builder
today. See §0.3.

---

## 3. Campaign build — every field, in Ads Manager order

Ads Manager → **Create**. Fields are named as Ads Manager names them in 2026
(objective at campaign level, **performance goal** at ad set level — see
[Jon Loomer, "21 Performance Goals"](https://www.jonloomer.com/performance-goals/)).

### 3.1 Campaign level

| Field | What to type or choose |
|---|---|
| Buying type | **Auction** |
| Objective | **Traffic** |
| Campaign name | `NX-UAE-AUDIT-META-PROSPECT-202609` |
| Special ad categories | **None.** NEXUS is B2B software — not credit, employment, housing or social issues. Do not let any copy drift into financing or loans, which would drag the account into the credit category and restrict targeting (`POLICY-RISK.md` §6). |
| Advantage campaign budget (CBO) | **OFF.** One ad set, so CBO adds a layer and no benefit. |
| A/B test | **OFF.** At this budget an A/B test is a machine for producing confident nonsense — `KILL-CRITERIA.md` §2 has the arithmetic. |

### 3.2 Ad set — name, destination, performance goal

| Field | What to type or choose |
|---|---|
| Ad set name | `DXB-SHJ-AUH-OWNERS-LPV-A28-60` |
| Conversion location | **Website** |
| Performance goal | **Maximise number of landing page views** |
| Pixel / dataset | Leave as-is. Traffic does not optimise on it, but the pixel still records. |
| Cost per result goal | **Leave blank.** A cost cap on a young account with no history throttles delivery to nothing. |

### 3.3 Budget and schedule

| Field | Value |
|---|---|
| Budget | **Daily budget** |
| Amount | **AED 40.00** |
| Start date | **Today**, at whatever time you finish. Do not schedule it for tomorrow morning; you will have lost a day and learned nothing. |
| End date | **None.** Leave it running and let the account spending limit stop it. |
| Schedule / dayparting | **Off — run all day, every day.** Concentrating AED 40 into a few hours buys thinner auctions and gives Meta less to learn from. (Note the irony and keep it: the product's whole pitch is that enquiries arrive at night. So do impressions.) |

**The stop-loss, in the order the rules fire** (from `LAUNCH-PLAN.md` §4, restated
here so you do not have to open it):

1. **AED 600** — the account spending limit. Platform-enforced. Set it in §1.
2. **AED 150 spent, under 15 link clicks** → pause everything. CPC above AED 10
   means the audience is unreachable at this budget or the creative is being
   scrolled past. Fix the ad, not the budget.
3. **AED 400 spent, 200+ landing page views, 0 form submissions** → pause
   everything. The ads worked; the page or the offer did not. More spend buys the
   same zero.
4. **AED 560 spent** → stop regardless and read `KILL-CRITERIA.md` before
   deciding anything.

**Never raise the daily budget above AED 60 in the first 30 days**, even if it is
working beautifully. A large jump resets the learning phase, and on a young ad
account a sudden multiple-x spend increase is one of the patterns that triggers a
payment or compromise review.

### 3.4 Audience

| Field | What to type or choose |
|---|---|
| Locations | **Dubai, Sharjah, Abu Dhabi.** Add Ajman only if the audience estimate comes back under ~40,000. |
| Location type dropdown | **"People living in this location."** Not the default. The default includes tourists and transiting travellers, who are a meaningful share of UAE Meta reach and worth exactly nothing here. |
| Age | **28 – 60** |
| Gender | **All** |
| Languages | **Blank.** The addressable pool is small and a language filter on top of an interest filter can shrink delivery to nothing. Arabic is handled by creative (§4.4), not by targeting. |
| Detailed targeting | Layer these with **OR** (Meta unions them inside the box): Behaviours → Digital activities → **Facebook Page admins**; Behaviours → **Small business owners**; Job titles → **Owner**, **General Manager**, **Managing Director**; Interests → **Car dealership**, **Used car**, **Automotive industry**. Add Industries → **Sales** only if the estimate is still under ~40,000. |
| **Advantage detailed targeting** | **OFF.** This is the single most expensive toggle on the screen. Left on, Meta treats your interests as a suggestion and expands to everyone in the UAE, and at AED 40/day that expansion eats the whole budget on people who will never buy. |
| **Advantage+ audience** | **OFF** for week 1, same reason. |
| Custom audiences | **None.** There is no list. From today the pixel starts building a website custom audience; do not spend a dirham on retargeting until it reaches ~300 people, which at this budget is roughly week 3. |

**Expect the audience estimate to read 50,000–400,000 and do not panic.** There
are on the order of a few thousand used-car showrooms in the UAE; interest
targeting is loose. **Targeting is the coarse filter. The copy is the real
filter** — every headline in §4 names the reader's situation in line one so the
wrong people self-deselect before they cost you a click.

### 3.5 Placements

**Manual placements.** Then, and only then:

- **Facebook → Feed → ON**
- **Instagram → Feed → ON**
- **Everything else OFF.** Specifically: **Audience Network OFF** (it buys the
  cheapest clicks in the world and almost none of them belong to a dealership
  owner), **Reels OFF**, **Stories OFF** (you have static images; a static image
  in a vertical video slot delivers badly and poisons the CTR read), Marketplace
  OFF, Search OFF, Messenger OFF.

Two placements keeps the signal readable. At AED 560 total the goal is one clean
number per ad, not maximum surface area.

### 3.6 Ad level — the three ads

Create three ads inside the one ad set. For each:

| Field | Value |
|---|---|
| Ad name | `MIDNIGHT-IMG-EN-v1` / `FIRSTREPLY-IMG-EN-v1` / `HONEST-IMG-EN-v1` |
| Identity → Facebook Page | **Adqonic** |
| Identity → Instagram account | The Adqonic Instagram if one is linked; otherwise **"Use selected Page"** |
| Format | **Single image** |
| Media | The creative from §4 |
| Primary text / Headline / Description | From §4. One ad, one angle. Do not mix. |
| Call to action | **Learn more** |
| Destination | **Website** |
| Website URL | `https://nexus-for-autodealers.vercel.app/` |
| **Multi-advertiser ads** | **OFF** if the toggle is offered |
| **Advantage+ creative** (auto-enhancements: crop, brightness, text variations) | **OFF, all of it.** It rewrites your text. Every line in §4 was written against a policy boundary (`POLICY-RISK.md` §2 and §3) and a paraphrase Meta invents has not been read by anybody. |

**Naming rules, and they matter:** UPPER-CASE, hyphens only. **No spaces, no
`&`, no `+`, no `/`, no commas.** These names are injected into the URL by Meta's
dynamic parameters, and a space arrives in your database as `%20`.

### 3.7 The tracking string — the single most important paste in this file

At **ad level**, in the **Tracking → URL parameters** field. **Not** appended to
the Website URL — keep that field clean so the destination is unambiguous in ad
review.

Paste exactly this, into all three ads:

```
utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}&utm_id={{ad.id}}
```

Every one of those six keys is on the deployed allowlist (`api/lead.js` lines
158–160, quoted in §0.2). Meta appends `fbclid` itself and that is allowlisted
too. **Anything you add that is not on that list is silently dropped by the
server** — no error, no warning, just a value that never existed.

What lands in the database for a click on the first ad from Instagram:

| key | value |
|---|---|
| `utm_source` | `ig` |
| `utm_medium` | `paid_social` |
| `utm_campaign` | `NX-UAE-AUDIT-META-PROSPECT-202609` |
| `utm_content` | `MIDNIGHT-IMG-EN-v1` |
| `utm_term` | `DXB-SHJ-AUH-OWNERS-LPV-A28-60` |
| `utm_id` | the numeric ad id |
| `fbclid` | appended by Meta |
| `landing_path` | `/` — set by the page, not the ad |

`utm_content` is the field that answers *which ad earned this*. Guard it.

### 3.8 Before you press Publish — the compliance pass

Run `POLICY-RISK.md` §7 against the three ads you just built. The two lines most
likely to catch you out:

- **ALBA Cars appears nowhere** — not in text, not in an image, not in a Page
  name, not in a link. ALBA is tenant #1 and the pilot, not a customer and not a
  reference. An ad implying ALBA bought or endorses NEXUS is a fabricated
  testimonial under Meta's rules and, separately, tells every competing showroom
  in Dubai that a rival is selling them software.
- **No scarcity of any kind.** No "only 10 places", no deadline, no countdown, no
  "founding rate", no "price goes up soon". **There is no cap and no deadline** —
  the offer is AED 399/month, flat and permanent, first month free
  (`ops/landing-page/PRICE-DECISION.md`). Urgency about a limit that does not
  exist is fake urgency: a Meta Advertising Standards problem and, more simply,
  a lie.

### 3.9 The last thing before Publish

**Open the ad preview on your phone, click through, and look at the address bar
when the landing page loads.** It must carry `utm_campaign=` and `utm_content=`.
Then submit one more test form from that clicked-through session and confirm the
row in `nexus_sales_lead` has a **populated `attribution` object**.

If the attribution is empty while Meta reports clicks, the tracking string is
wrong or was never pasted, and **the campaign is unjudgeable**. Fix it before
publishing, not after.

Then publish. **Then do not touch anything for 72 hours** (§5).

---

## 4. Creative — three Canva briefs, ready to build

### 4.0 Specs and constraints that apply to all three

| | |
|---|---|
| Primary size | **1080 × 1350 px (4:5)** — takes the most vertical space in both Facebook Feed and Instagram Feed |
| Backup size | **1080 × 1080 px (1:1)** — upload as the square crop if Ads Manager asks for one |
| Format | JPG or PNG, under 30 MB |
| Safe zone | Keep all text inside the central ~80%. Feed crops the edges on some devices. |
| Colour | Dark, high contrast. The Feed is bright and cluttered; a dark frame stops a thumb. |

**On text in the image.** Meta's old hard 20%-text rule **no longer causes
rejection** — it was removed
([Social News Desk](https://www.socialnewsdesk.com/blog/facebooks-20-rule-is-no-more/),
[Sphere Agency](https://sphereagency.com/articles/goodbye-facebook-text-overlay)).
But low text still reads better and still delivers better, and these are agency
summaries rather than Meta's own page, so treat the guidance as advice and not as
a rule you can lean on. **Keep every overlay to one short line. Never put the
whole headline in the image.**

**Three things that must never be in any image:** any car manufacturer's badge or
logo (Toyota, Nissan, Lexus, anything — a trademark complaint disables the ad),
any marketplace name or screenshot (Dubizzle, YallaMotor, dubicars), and anything
identifying ALBA Cars or its premises.

**Two things worth avoiding on craft grounds:** a stock-photo handshake, and a
stock-photo salesman handing over keys. Every agency ad in the UAE Feed uses
both, and a dealer's eye has learned to skip them.

**The rule every line of text below obeys**, without exception: it is a
**capability claim** (what the software does, present tense, checkable against
`PRODUCT.md` and the landing page), a **question** about the reader's situation,
or a **disclosed fact about the offer**. Never a result claim. There are no
results to claim: one pilot dealership, no paying customers.

**"Four questions" appears throughout below.** If you did Fix A in §0.1 and the
form now has the free-text field, change it to "five" — and only then.

---

### 4.1 Ad 1 — `MIDNIGHT-IMG-EN-v1` — **the strongest angle**

**Why this one is the strongest.** It is the only angle where the reader supplies
the evidence himself. He already knows enquiries land after closing, because he
has seen the timestamps on his own salesmen's phones. The ad does not have to
persuade him of a problem — it names a thing he has personally observed and has
never had a name for, and then says, mechanically, what the software does about
it. It needs no statistic, no testimonial and no result claim to land, which is
precisely why it is safe here: **the honesty constraint costs this angle
nothing.** Every other angle in `AD-COPY.md` is either borrowing an industry
statistic, disclaiming a weakness, or leading with price.

**Canva brief**

- **Size:** 1080 × 1350.
- **Image:** A car showroom floor at night, seen from inside. Lights off or
  down, glass frontage, the street outside dark. Cars are silhouettes — **no
  badge, no grille detail, no model identifiable**. In the lower third, a single
  phone face-up on a desk or counter, screen lit, throwing a small pool of light.
  That phone is the only bright thing in the frame.
- **Mood:** Quiet, not dramatic. This is an empty building at 11:40pm, not a
  thriller.
- **Text overlay:** one line, bottom-left, inside the safe zone, white on the
  dark area, large and set tight:
  > **11:40pm. Three enquiries. Nobody on the floor.**
- **Second overlay (optional, small, bottom-right corner, 40% opacity):**
  `NEXUS for AutoDealers`
- **Do not** add a price, a button graphic, an arrow, or a badge shape. The price
  is in the text and the CTA is a real button Meta renders.

**Primary text** (paste into the Primary text field)

> Showrooms in Dubai close at 9pm. The enquiries don't.
>
> A buyer messages three dealerships at 11:40pm. By morning one of them has
> already booked the test drive.
>
> NEXUS answers every enquiry as it lands, scores it, and routes it to the right
> salesperson — at 11:40pm as readily as at 11am. Grounded in your real prices.
> Silent the moment your team steps in. Every word on the record.
>
> Free dealer audit: four questions, on your own stock, not a canned demo.
>
> Built in Dubai for UAE showrooms. First month free, then AED 399/month.
> No setup fee, no contract.

**Headline:** `The enquiries that arrive at midnight`
**Description:** `Free dealer audit · Dubai`
**CTA button:** `Learn more`

*Mobile truncates the primary text after roughly the first 125 characters behind
a "See more". The first two lines above are therefore the whole ad for most
readers, and they were written to work alone.*

---

### 4.2 Ad 2 — `FIRSTREPLY-IMG-EN-v1`

**Canva brief**

- **Size:** 1080 × 1350.
- **Image:** Four identical phone-message bubbles stacked vertically on a flat
  dark background, each carrying the same short enquiry text and the same
  timestamp — `11:41 PM`. Three of the four are greyed out. The fourth has a
  reply bubble beneath it. **No brand chrome:** do not draw WhatsApp's logo, its
  green, or a recognisable imitation of its interface. Plain rounded rectangles.
- **Mood:** Diagrammatic and calm. This one is an illustration, not a photograph,
  and it should look deliberately unlike everything else in the Feed.
- **Text overlay:** one line, top, inside the safe zone:
  > **Four showrooms. One reply.**

**Primary text**

> A buyer messages four showrooms at once. Which one replies first?
>
> Published research on buyer behaviour is blunt about this: contacting a lead
> within five minutes instead of thirty makes it dramatically more likely to
> qualify, and the first showroom to answer usually sets the price expectation.
> Those are the market's numbers, not ours.
>
> NEXUS answers on arrival, scores the enquiry, and puts it in front of the right
> salesperson with what they need to say next.
>
> Free dealer audit — four questions, on your own inventory.
> AED 399/month after a free first month. No contract.

**Headline:** `Who answers first, wins the test drive`
**Description:** `Four questions. Free audit`
**CTA button:** `Learn more`

> **Do not add a percentage to this ad, in the text or in the image.** The
> five-minute finding is an industry statistic, not ours. It is framed here as
> *"published research"* and *"the market's numbers, not ours"*, exactly as the
> landing page frames it, and **with no number** — because a percentage without a
> visible citation is an unsubstantiated claim under Meta's rules, and an ad has
> no room for a citation. If you ever want the number in an ad, the citation has
> to fit beside it.

---

### 4.3 Ad 3 — `HONEST-IMG-EN-v1`

**Why this one is in the set.** It is the highest-variance ad you will run. UAE
SME owners are saturated with agencies promising results; an advertiser that
opens by disqualifying itself gets read. It also makes the ad and the landing
page say precisely the same thing, which is the consistency Meta's review
explicitly checks for. It will either be your best CTR or your worst. Both
outcomes are informative.

**Canva brief**

- **Size:** 1080 × 1350.
- **Image:** Almost none. A plain, flat, near-black field. Centre-left, in large
  type, the overlay line. Bottom-left, small: `NEXUS for AutoDealers · Dubai`.
  **This ad is a typographic card, and that is the point** — it looks like a
  statement rather than an advertisement, in a Feed made entirely of
  advertisements.
- **Do not** add a photograph, a gradient, a device mockup or a dashboard
  screenshot. A dashboard screenshot in particular invites the reader to judge
  the UI instead of the offer, and it is the fastest way to make a new product
  look like a hundred others.
- **Text overlay:**
  > **We can't show you a wall of dealer logos.**
  > *(second line, smaller, 60% opacity)* **We don't have one yet.**

**Primary text**

> We can't show you a wall of dealer logos. We don't have one yet.
>
> NEXUS is a new product. One showroom in Dubai runs it today as a pilot, and we
> have no paying customers. That is exactly why the dealer audit is free and the
> first month is free — you should not pay to find out whether something works.
>
> What it does: answers, scores and routes every enquiry including the overnight
> ones. Recomputes days-in-stock nightly and flags the units eating margin. Keeps
> every conversation on the record.
>
> Four questions and we'll walk you through what we find in your own showroom.
>
> AED 399/month if you keep it. No setup fee. No contract.

**Headline:** `A new product, and we say so`
**Description:** `First month free · AED 399`
**CTA button:** `Learn more`

---

### 4.4 Arabic — the strongest angle, `MIDNIGHT-IMG-AR-v1`

Run this as a **fourth ad in the same ad set**, not as a separate ad set — at
AED 40/day a second ad set splits a budget that is already thin.

**Have a native Arabic speaker read it before it goes live.** An honesty
disclosure that reads awkwardly does more damage than no disclosure at all.

**Timing note:** Arabic-language ads occasionally take longer in review
(`POLICY-RISK.md` §6). If the English three are ready and this one is not
reviewed yet, **publish the three and add this one tomorrow.** Do not hold the
launch for it.

**Canva brief:** identical to §4.1 — same night-showroom image, same 1080 × 1350.
Change only the overlay: right-aligned, Arabic, one line.

- **Text overlay:**
  > **١١:٤٠ ليلاً. ثلاثة استفسارات. لا أحد في المعرض.**

**Primary text**

> المعارض في دبي تغلق أبوابها الساعة ٩ مساءً. الاستفسارات لا تتوقف.
>
> عميل يراسل ثلاثة معارض في الساعة ١١:٤٠ ليلاً. وفي الصباح، أحدها قد حجز تجربة
> القيادة بالفعل.
>
> نظام NEXUS يرد على كل استفسار فور وصوله، يقيّمه، ويحوّله إلى الموظف المناسب —
> في الساعة ١١:٤٠ ليلاً تماماً كما في الحادية عشرة صباحاً. يعتمد على أسعارك
> الحقيقية، ويصمت فور تدخّل فريقك، وكل كلمة مسجّلة.
>
> تدقيق مجاني لمعرضك: أربعة أسئلة فقط، على مخزونك أنت، وليس عرضاً جاهزاً.
>
> مبني في دبي لمعارض الإمارات. الشهر الأول مجاني، ثم ٣٩٩ درهماً شهرياً.
> بدون رسوم تأسيس وبدون عقد.

**Headline:** `استفسارات منتصف الليل، مُجاب عليها`
*(English gloss: "Midnight enquiries, answered.")*
**Description:** `تدقيق مجاني للمعرض · دبي`
**CTA button:** `Learn more`

**Ad name:** `MIDNIGHT-IMG-AR-v1`

> **One caution.** The landing page is **English-only**, and says so on the form:
> *"We speak English and Arabic on WhatsApp; this page is English-only for now."*
> An Arabic ad therefore sends an Arabic reader to an English page. That is an
> honest mismatch rather than a policy one — the page discloses it — but it will
> depress this ad's conversion rate relative to its CTR, and you should read its
> numbers knowing that. If the Arabic ad earns clicks and no submissions, that is
> **not** evidence the angle failed.

---

## 5. The first 24 hours

### 5.1 What to look at

Open Ads Manager **once**, roughly 6–8 hours after publishing, and check four
things — all of them delivery, none of them performance:

1. **Is it spending at all?** If spend is AED 0 after six hours, something is
   blocking: ad review, billing, or an audience so narrow Meta cannot fill it.
2. **Is every ad delivering?** Impressions > 0 on each. If one shows zero, it is
   in review, rejected, or the budget is too thin to split three ways.
3. **Account Quality** (`business.facebook.com/accountquality`). Any rejection or
   restriction shows here, with the reason. Nothing else on this list matters if
   this one is red.
4. **Did anything arrive in the database?** Run §5.3. Probably nothing has, and
   that is the expected outcome.

### 5.2 What NOT to react to — and this is the harder half

**Do not touch anything for 72 hours.** Not the budget, not the audience, not
the copy, not the images. Not one field.

Specifically, none of the following is a signal on day one:

- **A CPC of AED 14 in the first hours.** The auction has no history for this
  account and the first hours are the most expensive and least representative
  clicks you will buy all fortnight.
- **All the spend landing on one ad.** Normal. Meta concentrates. Leave it alone.
- **Zero form submissions.** Expected. `KILL-CRITERIA.md` §0 puts the *whole
  first week* at **0–4** completed audit forms. Day one's honest expectation is
  zero.
- **One ad at 1.2% CTR and another at 0.8%.** With a few dozen clicks that gap is
  noise. Only act on differences of **3x or more** (1.5% vs 0.4%).
- **A bad day followed by a good day.** Day-to-day swings at this budget are
  almost entirely auction noise on a sample of fifteen clicks.

**Never pause an ad before 1,000 impressions or 72 hours, whichever is later.**
Every pause-and-restart re-enters the learning phase and spends part of what is
left re-learning what Meta already knew. At AED 560 total you can afford that
roughly never.

**One change at a time, then 72 hours untouched.** Two simultaneous changes at
this sample size make the result unattributable, which means you paid for
information you then destroyed.

### 5.3 The query that actually counts what happened

Ads Manager tells you what Meta did. This tells you what happened.

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

A row with an **empty `attribution`** is an organic visitor. Do not credit it to
the campaign.

### 5.4 The single condition under which you turn it off in the first 24 hours

There is exactly one, and it is not a performance number:

> **Meta reports link clicks, and every arriving row has an empty `attribution`
> object.**

That means the tracking string in §3.7 is wrong or was never pasted. Every
dirham from that moment on buys a click you cannot attribute, cannot judge, and
cannot learn from. **Pause the campaign, fix the URL parameters field, confirm
with one clicked-through test submission, and restart.**

Everything else — bad CPC, no clicks, no leads, ugly numbers — waits for the day
3 and day 7 gates in `KILL-CRITERIA.md`. **A stop rule invented on day one while
looking at a chart is not a stop rule. It is a rationalisation.**

*(The one genuine exception that is not a metric at all: if Account Quality shows
a **restriction** — not a single rejected ad, a restriction on the account or the
Page — stop, read `POLICY-RISK.md` §5, and **file exactly one appeal**. Do not
create a second ad account or a second business portfolio. That is the single
most common way a restriction becomes a permanent ban.)*

---

## 6. What this pack cannot do for you

Honestly and completely. Everything below requires Ali, in person, and no agent
can do any of it — not because of a missing integration, but because each one is
an identity, a payment instrument, a legal consent, or a judgement that is his to
make.

**Requires his payment method or billing identity**

1. Adding a card to the ad account. Nobody else's card belongs on it.
2. Setting the **AED 600 account spending limit**.
3. Accepting Meta's advertising terms on the account.
4. Every dirham of the AED 560. This pack has spent nothing and can spend
   nothing.

**Requires his identity**

5. **Business verification** on the Adqonic portfolio — documents in the
   business's legal name.
6. Page role and admin access on the Adqonic Page.
7. Logging into Events Manager to create the pixel and read the Dataset ID.
   *(The ID itself is a public identifier that ships in the page source of every
   site using it, so it is safe to write into the repo and safe to tell an agent.
   Getting it requires being logged in as him. No access token, App Secret or
   developer token is involved in any step of this file, and none should ever be.)*

**Requires his approval or his hands**

8. **Pressing Publish.** Deliberately. Nothing here is submitted or scheduled.
9. The `index.html` edit and the Vercel deploy that carry the pixel ID live.
10. Building the three images in Canva. §4 is a brief, not an asset.
11. The Arabic read-through by a native speaker before `MIDNIGHT-IMG-AR-v1` runs.
12. Furnishing the Adqonic Page — profile image, cover, description, website
    link, 2–3 posts.

**Requires a judgement only he can make**

13. **Whether to do Fix A or Fix B in §0.1.** Fix A costs five minutes and gets
    back the free-text answers that `KILL-CRITERIA.md` calls more valuable than
    the entire click dataset. Fix B costs nothing and changes a word. Both are
    honest. Only one is more useful.
14. **Whether AED 560 is affordable this month.** This pack assumes it is because
    `LAUNCH-PLAN.md` says so. It is a price paid for one piece of information —
    *will a UAE dealer give up four answers for a free audit?* — and not an
    investment with an expected return. If the answer turns out to be no, that is
    worth knowing for AED 560.
15. **Whether to accept the Adqonic Page trade.** A dealer who clicks the
    advertiser's name lands on a marketing agency, not on NEXUS, and every
    follower and review this spend generates accrues to Adqonic. That was decided
    on 17 September 2026 and it remains the only option that lets spend start
    today — but it is a cost paid quietly, and it is his to keep paying or stop.
16. **Replying on WhatsApp, same day, as a human.** The landing page promises
    *"a real person in Deira"*. The whole funnel is worth nothing if that promise
    is the one thing in it that is automated.

---

## Sources consulted for this file

Repository and live-site facts were verified directly on 17 September 2026:
`apps/marketing-site/index.html` (lines 307, 319, 686, 784 and the form block),
`apps/marketing-site/api/lead.js` (lines 143, 158–160), and
`https://nexus-for-autodealers.vercel.app/` (HTTP 200, `nexus:meta-pixel-id`
empty in production).

External, and all **agency or practitioner sources rather than Meta's own
documentation** — treat them as orientation, not as the binding rule:

- Jon Loomer, *"21 Performance Goals: The Focus of Meta Ads Optimization"* —
  <https://www.jonloomer.com/performance-goals/> (current Ads Manager naming:
  objective at campaign level, **performance goal** at ad set level)
- Social News Desk, *"Facebook's 20% Text Rule Is Gone"* —
  <https://www.socialnewsdesk.com/blog/facebooks-20-rule-is-no-more/>
- Sphere Agency, *"Facebook Removed Text Overlay Rule"* —
  <https://sphereagency.com/articles/goodbye-facebook-text-overlay>
- SuperAds, *"Facebook Ads CPC Benchmarks in United Arab Emirates"* —
  <https://www.superads.ai/facebook-ads-costs/cpc-cost-per-click/united-arab-emirates>
- Hikmah AI Agency, *"Meta Ads Cost in Dubai 2026: Real CPMs by Platform
  (AED 10–40)"* —
  <https://www.hikmahaiagency.com/blog/meta-ads-cost-dubai-2025>

The binding policy text is always Meta's own, already cited in `POLICY-RISK.md`
§1: <https://transparency.meta.com/policies/ad-standards/>

**No CPC, CPM, CTR or lead-count figure anywhere in this file is a forecast.**
We have never run a paid campaign for this product. The ranges size the decision;
they do not predict the result.
