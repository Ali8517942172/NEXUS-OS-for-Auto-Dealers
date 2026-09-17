# Landing page audit — nexus-for-autodealers.vercel.app

**Agent OFFER · 17 September 2026 · judged as a Dubai used-car dealership owner, not as an engineer.**

Scope: the live page fetched with `curl` on 17 Sep (HTTP 200, 37,213 bytes) and
`apps/marketing-site/index.html` in the repo. **The repo file is ahead of what is
deployed** — the local copy already carries a reworked Meta Pixel block with
`eventID` de-duplication that the live HTML does not have. Anything below that
refers to the live page refers to the 37,213-byte deployed copy.

---

## The four blunt answers

### (a) Would a UAE dealer understand within 5 seconds what this is and what it costs?

**Cost: yes. What it is: no.**

The price was on the page before I touched it and that is genuinely rare and
genuinely good. But the first screen was a slogan — *"Your dealership doesn't need
more enquiries. It needs to lose fewer of them."* — followed by *"NEXUS finds
missed follow-ups, hot buyers and revenue leaking out of your pipeline."* A dealer
in Deira reading that does not learn whether NEXUS is software, an agency, a
dashboard, a chatbot on his website, or a person. The word **WhatsApp** — which is
the only channel that has ever actually worked, and the one thing a UAE dealer
instantly understands — did not appear above the fold at all.

**Fixed.** A "What it actually is" line now sits directly under the headline: an AI
layer on the WhatsApp number enquiries already arrive on and on the stock list, not
a CRM, not a website chatbot, replacing nothing.

### (b) Is there a priced subscription anywhere, or only "book a demo"?

**There is a published price — and it is the wrong one, or the pricing doc is.**

The page publishes **AED 399/month, first month free, no setup fee, no minimum
term, unlimited stock**. It repeats this in `<meta name="description">`, in og/twitter
cards, and as `schema.org/Offer` JSON-LD with `"price": "399"`.

The only priced decision in this repository is `commercial/PILOT-OFFER.md` v2.2
(8 September 2026), which says, verbatim:

> **Setup: AED 5,000, one time. Monthly: AED 2,500 to AED 3,500. Three-month minimum.**

Those are not two framings of one offer. They disagree on every axis:

| | Live page | `commercial/PILOT-OFFER.md` v2.2 |
|---|---|---|
| Setup | AED 0, "included" | **AED 5,000** |
| Monthly | AED 399 | **AED 2,500 – 3,500** |
| Minimum term | None, cancel any time | **Three months** |
| Stock size | "Unlimited" | **+AED 250 above 50 vehicles** |
| Logins | not mentioned | **+AED 250 above 5 people** |
| Q1 total | AED 0 | **AED 12,500 – 15,500** |

**AED 399 is below your own documented cost of delivery.** The same PILOT-OFFER
costs infrastructure at Google Cloud VM ~100 + Supabase ~92 + AI calls 110–220 +
WhatsApp Cloud ~100 = **AED 402–512 per month, per dealer, before a single hour of
your time.** At AED 399 you lose money on every customer from the day they sign,
and the free first month makes month one worse. The document says of AED 2,500,
"Honestly: only just."

Worse, the page bound you to it: *"The first 50 UAE showrooms to come on keep AED
399 for good, whatever we charge later."* That is a lifetime price lock, below
cost, offered to fifty companies, published on a public page. **I removed it.** I
did not change the AED 399 figure itself — that is your commercial call, not mine,
and silently rewriting a published price to AED 2,500 would be as wrong as leaving
the lock in place. See `PRICING-QUESTIONS.md` next to this file.

### (c) Does the page make any claim the database cannot back?

Three, one of them fixed by removal and two by sourcing.

1. **"The first 50 showrooms keep AED 399 for good."** Nothing backs this and it is
   a commitment, not a claim. Removed, replaced with an honest early-rate line that
   promises notice before renewal instead of a price for life.
2. **"Number of cars in stock: Unlimited."** Contradicted by your own cost model,
   which prices stock above 50 vehicles as extra work. Replaced with "sized with
   you in the audit."
3. **Unsourced industry statistics.** *"Contacting a lead within five minutes rather
   than thirty makes it dramatically more likely to qualify"* sat under a heading
   that called it *"published research"* with no publication named and nothing to
   click. Replaced with the actual, linkable source — Oldroyd, McElheran &
   Elkington, *"The Short Life of Online Sales Leads"*, Harvard Business Review,
   March 2011 — quoted at what that article actually says (≈7× within the hour,
   >60× against a day's delay), with an explicit note that it is neither automotive
   nor UAE. The other two tiles are now labelled **"Observation, not a statistic"**
   and say out loud that no survey stands behind them.

**What the page gets right and I left alone:** it already states that there is one
pilot dealership and zero paying customers; it already refuses to put a dirham
figure on the visitor's losses; the FAQ already publishes the slow end of the
response-time range (13.3s fastest / 38.8s median / 3m38s slowest), which matches
`commercial/WHAT-WE-CLAIM.md` line 145 exactly. The Fortuner AED 152,000 example
matches PILOT-OFFER. This page is more honest than most funded startups' pages.

One compliance item I did enforce: `WHAT-WE-CLAIM.md` withdraws **"any response-time
number at all"** including *"in minutes, not hours"*. That phrase was live in the
`og:description` and `twitter:description` meta tags — invisible on the page,
visible on every WhatsApp and LinkedIn share. Removed from both.

### (d) Is the form short enough for a cold paid click?

**No. It was five required fields including a free-text box.** Name, dealership,
WhatsApp, a required stock-size dropdown, and a **required textarea** — "Biggest
challenge right now". A cold click off a Meta ad does not write you a paragraph
about his showroom's failings before he knows who you are. The client-side
validator refused the submission with *"Tell us the one thing costing you most
right now."*

**Fixed.** Three required fields — name, dealership, WhatsApp — plus an optional
stock-size select with a "Rather not say" default. The textarea is gone entirely;
that context arrives in the WhatsApp reply anyway. The two matching `return`
guards in the submit handler were removed so the JS agrees with the markup.

---

## The three biggest conversion problems, ranked

1. **The page had an offer name but no offer.** "Get a Free Dealer Audit" appeared
   four times and nowhere said what a dealer receives, how long it takes, what he
   has to hand over, or what happens next. The sub-line was "Five questions." A
   dealer cannot say yes to a noun. Now there is an explicit deliverable block:
   a one-page written note on WhatsApp; how long enquiries to his own number
   actually take to be answered (three test enquiries, timed, **with his say-so**);
   about 20 minutes of his time; back within two working days; no logins, no DMS
   access, no stock file; and the note will say so if he doesn't need NEXUS.
2. **Below-cost price plus a lifetime lock.** Covered in (b). This is a commercial
   problem wearing a landing-page costume and it is the single most expensive line
   on the site.
3. **Five fields for a cold click, one of them an essay.** Covered in (d).

**Two more that are cheap and were costing you everything:**

4. **The canonical tag pointed at a 404.** `<link rel="canonical">`, `og:url` and
   both JSON-LD `@id` values read `https://nexusforautodealers.vercel.app/` —
   **unhyphenated**. I fetched it: **HTTP 404**. You were telling Google that the
   real page is a duplicate of a page that does not exist, and every share card
   resolved to nothing. `sitemap.xml` and `robots.txt` had the hyphenated host
   correct, so the page was contradicting its own sitemap. All four occurrences
   fixed.
5. **The form may still not deliver.** `ops/channel-truth/2026-09-12-LIVE-CAPTURE-TEST.md`
   records `POST /api/lead → HTTP 503` on both 7 and 12 September, caused by
   `RESEND_API_KEY` / `NEXUS_NOTIFY_FROM` being unset on the Vercel project, and
   notes the consequence plainly: *"Any traffic driven to it converts at zero by
   construction."* A `POST {}` today returns **HTTP 400 `name_required`**, so
   validation runs — but that proves nothing about the notification path, and I did
   not submit a real lead to find out. **Verify this before a single dirham of ad
   spend.** The 503 fallback text ("WhatsApp +971 52 664 7253 directly") is intact
   and is the only thing currently standing between a paid click and a black hole.

---

## What I changed in `apps/marketing-site/index.html`

Everything the brief told me to preserve is preserved and verified by grep: the
attribution IIFE (`NEXUS_ATTRIBUTION`, first-touch, sessionStorage, allowlisted
UTM/click-id keys), the browser-minted `submission_id` idempotency key, the inert
pixel pattern (`<meta name="nexus:meta-pixel-id" content="">` — still empty, still
loads nothing), the `Lead` event firing on 200 only, and both the 200 and 503
message branches word for word.

- **Head:** canonical/og:url/JSON-LD host corrected (4×); withdrawn response-time
  phrasing removed from meta description, og and twitter cards.
- **Hero:** badge now leads with the free audit and "price published below"; a
  "What it actually is" paragraph added; CTAs renamed to *Get my free dealer audit*
  and *WhatsApp Ali directly* (the old second CTA said "Book a Demo", which is not
  the funnel — the funnel is audit → founder → demo).
- **Offer card:** retitled *Free Dealer Audit*, with a four-item deliverable list.
- **Form:** 5 required fields → 3; textarea removed; stock select made optional.
- **Trust strip** under the form: no salesperson will call, we never ask for cost
  prices, the audit touches nothing you run, English and Arabic on WhatsApp, and a
  direct WhatsApp link for dealers who will not fill a form at all.
- **Proof section:** HBR 2011 named and linked; two tiles relabelled as observations.
- **Price section:** lifetime founding-rate lock removed; "Unlimited" removed; FAQ
  answer that repeated the lifetime lock rewritten.
- **Contact:** Arabic line (`dir="auto"`) with an Arabic-prefilled `wa.me` link,
  stating plainly that a full Arabic page is **not built yet**.
- **CSS:** two small classes added (`.audit-list`, `.trust`). No layout rewrite.

## Arabic — the honest position

Roughly half of Dubai's used-car trade runs in Arabic, and a paid Meta campaign
aimed at showroom owners will hit Arabic-first buyers. The page is English-only and
`<html lang="en">`. I did **not** machine-translate it: a half-Arabic page with an
English form and English WhatsApp replies reads as a foreign vendor and converts
worse than an honest English page. What I did instead is a one-line Arabic entry
point to WhatsApp, where Ali can genuinely answer in Arabic today.

**The real decision, for Ali:** a proper `/ar` page with `dir="rtl"`, a translated
form, `hreflang` pairs, and an Arabic-language ad set — worth doing only once the
audit offer is proven to convert in English. Do not translate a page that does not
convert yet.

## Not fixed, deliberately

- **The AED 399 figure itself.** Ali's call. `PRICING-QUESTIONS.md`.
- **The `/api/lead` delivery path.** Needs Vercel environment variables, which is
  secret-handling and outside my remit.
- **Any social proof.** There is none to show. One pilot, zero paying customers, and
  the page already says so in two places. Leave it saying so.
