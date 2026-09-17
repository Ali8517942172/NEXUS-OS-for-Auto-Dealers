# NEXUS OS — Paid Ads Policy Risk

Date written: 2026-09-17
Scope: Meta (Facebook/Instagram), Google Ads, WhatsApp Business messaging.
Purpose: name what would get the ad account restricted, and show where the
copy in AD-COPY.md already avoids it.

**Why this matters more than usual here.** Ali has one Meta business portfolio
(Adqonic, `1414977205987811`) and one ad account. A restriction is not a
setback of a few days — for a solo founder it is the end of the channel, and
the single most common way people turn a restriction into a permanent ban is
by creating a second ad account to get around the first. Do not do that.

---

## 1. Sources

- Meta, **Privacy Violations and Personal Attributes** —
  <https://transparency.meta.com/policies/ad-standards/objectionable-content/privacy-violations-personal-attributes/>
- Meta Advertising Standards (index) —
  <https://transparency.meta.com/policies/ad-standards/>
- Third-party summary used for the worked examples in §2 and §3:
  auditsocials.com, *"Meta Ad Standards 2026: Personal Attributes + Claim
  Fixes"* —
  <https://www.auditsocials.com/blog/meta-ad-misleading-claims-personal-attributes-prohibited-content-policy-2026>
  (an agency blog, not a primary source — the binding text is Meta's own page
  above)
- UAE CPC/CPA ranges cited in LAUNCH-PLAN §1: mshahid.com, *"Google Ads Cost
  in the UAE: 2026 CPC Guide by Industry"* —
  <https://mshahid.com/blog/google-ads-cost-uae> (also an agency blog; used for
  order-of-magnitude sizing only)

---

## 2. Personal attributes — the most likely reason a B2B ad gets rejected

**The rule.** Meta prohibits ad copy that directly or indirectly asserts or
implies knowledge of a viewer's personal attributes — including health
condition, disability, **financial status**, race, religion, sexual
orientation, age, and criminal history. The trap is the *indirect* half: you
do not have to name the attribute, only imply you know it applies to the
reader.

**Why a dealership ad walks near it.** The instinctive B2B hook is
second-person and negative: *"You're losing leads."* *"Your sales team is
dropping enquiries."* *"Struggling to keep your showroom profitable?"* The
last of those implies knowledge of the reader's financial position, which is
squarely inside the policy. The first two are about a business rather than a
person, which is usually fine — but ad review is automated and pattern-based,
and *"your [X] is failing"* is exactly the pattern it is trained on.

**How AD-COPY.md avoids it.** Every ad uses one of two framings:

| Risky pattern | What the file actually says |
|---|---|
| "You're losing enquiries overnight" | "Showrooms in Dubai close at 9pm. The enquiries don't." *(third person, category framing)* |
| "Your showroom is struggling" | "A buyer messages four showrooms at once. Which one replies first?" *(question about the market)* |
| "You can't afford to keep losing deals" | "AED 399 a month. First month free." *(disclosed fact about the offer)* |

The three permitted sentence types in AD-COPY.md — capability claim, question,
disclosed offer fact — were chosen for exactly this reason.

**The two lines to watch.**

1. Ad 4 (`WHATSAPP-IMG-EN-v1`) opens *"How many of your showroom's enquiries
   live on a salesman's personal WhatsApp?"* — second person, but a question
   about a business practice, not an assertion about a person. Acceptable. If
   it is disapproved, the fix is to change "your showroom's" to "a showroom's".
2. Ad 5 (`STOCK-IMG-EN-v1`) opens *"The unit that has been on your lot since
   June is still costing you money today."* This asserts something about the
   reader's inventory and money. It is a business fact, not a personal
   attribute, but it is the closest line in the file to the boundary. **If any
   disapproval lands on the ad set, pause this ad first** and reword to "A unit
   that has been on a lot since June is still costing money today."

---

## 3. Misleading and unsubstantiated claims

**The rule.** Ads may not contain deceptive or unsubstantiated claims —
specific outcome guarantees, unsupported statistics, fabricated testimonials,
income promises, fake urgency or scarcity, or before/after transformations
implied as typical. Critically, **the policy applies to the ad creative, every
text field, AND the landing page** — all three must be consistent.

**Scarcity is banned outright here, and not only as a policy matter.** The offer
decided on 17 September 2026 is **AED 399/month, flat and permanent, first month
free, no setup fee, no minimum term** — no cap on dealership count, no end date.
Earlier copy in this repository advertised "the first 10 UAE dealerships" and
"until 31 October 2026". **Those limits no longer exist.** Running them now would
be fake urgency about a non-existent limit: squarely the prohibited pattern
above, and a lie told to a buyer. Strip any such line from creative, from every
text field, and from the landing page before spend starts.

**This is where NEXUS is genuinely exposed**, because the product's real value
is a result claim and we have no results to claim. The database cannot back a
single outcome number: one pilot dealership, no paying customers, no completed
attribution chain from ad to sale.

**What is therefore forbidden in every ad, forever, until the database can
back it:**

- Any "NEXUS recovered AED X" / "AED X in pipeline rescued" figure
- Any percentage uplift, conversion improvement, or response-time improvement
  attributed to NEXUS
- Any client-results number of any kind
- Any testimonial, quote, or "what dealers say"
- Any logo, name, or photograph of a dealership that is not a paying customer —
  which is currently **every** dealership
- **The ALBA Cars name, logo or premises.** ALBA is tenant #1 and the pilot,
  not a customer and not a reference. An ad implying ALBA endorses or
  purchased NEXUS is a fabricated testimonial under this policy and, separately,
  a commercial disaster with every competing showroom.
- Countdown timers, "only 3 pilot slots left", or any deadline that is not real
- "Guaranteed", "risk-free", "ROI guaranteed"

**The one industry statistic used, and how it is handled.** Ad 2
(`FIRSTREPLY-IMG-EN-v1`) refers to the five-minute lead-response finding. It is
written as *"published research on buyer behaviour"* and *"those are the
market's numbers, not ours"*, with **no percentage in the ad**, because a
percentage without a citation is an unsupported statistic and there is no room
in an ad for a citation. The landing page carries the same framing
(`apps/marketing-site/index.html`, "Why this is worth a month of your time",
which states explicitly: *"These are the market's numbers, not ours"*), so the
ad and the landing page agree — which is what review checks.

**The landing page is an asset here, not a liability.** It states in the hero
that NEXUS is a new product, that one pilot showroom runs it, and that there
are no paying customers. It explicitly refuses to put a dirham figure on the
reader's losses. An ad whose landing page *under*-claims is the easy case for
review. Do not "improve" the page by adding social proof it cannot back.

**"Free" claims.** "Free dealer audit" and "first month free" are both
policy-sensitive because Meta and Google both police free offers that are not
actually free. Both are true, both are stated on the landing page with the
follow-on price (AED 399/month, with no setup fee and no minimum term) visible in
the same viewport, and neither requires a card. Keep it that way — the moment the audit requires a payment
method, every ad in this file becomes non-compliant.

---

## 4. WhatsApp and lead-generation policy

Three distinct rule sets, often confused:

**(a) Click-to-WhatsApp ads.** Not used in this launch. The funnel is bound to
the landing page (LAUNCH-PLAN §0), so no ad sends a click into WhatsApp. This
also avoids a real risk: click-to-WhatsApp conversations that begin with an
unsolicited sales pitch are a common source of WhatsApp Business account
quality downgrades, and a downgraded WhatsApp number is a problem for the
*product*, not just the marketing.

**(b) Outbound WhatsApp to audit requesters.** The landing page form says
plainly: *"This goes to a real person in Deira, Dubai — we reply on WhatsApp,
usually the same day. Your details are used to contact you about NEXUS and
nothing else."* That sentence is the opt-in, and it is why it must stay on the
page. Under WhatsApp's Business Messaging Policy the reply must be to someone
who gave the number for this purpose (they did), within a session window or
using an approved template, and must not be bulk-broadcast to a scraped list.
**Never import a list of dealership numbers from anywhere and message them.**
That is the fastest route to losing the number the product depends on.

**(c) Meta Instant Forms (lead ads).** Not used, for funnel reasons
(LAUNCH-PLAN §3). If they are ever used, note: a privacy policy URL is
mandatory (the site has `/privacy.html`), and lead forms must not request
sensitive information. Specifically **never ask for Emirates ID number, trade
licence number, passport, bank details or VAT registration in an ad form.**
Business-qualification fields (dealership name, stock size) are fine.

---

## 5. Account-level risk, which is not about copy at all

| Risk | Why it bites here | Mitigation |
|---|---|---|
| New Page, no content | A Page with no image, description or posts running paid ads is a spam pattern. Higher review scrutiny, and buyers bounce | Furnish the Adqonic Page before launch — image, description, website link, 2–3 posts (LAUNCH-PLAN §2) |
| New ad account, sudden spend jumps | Multiplying a young account's daily budget looks like a compromised account | Cap at AED 60/day for 30 days. Account spending limit AED 600 |
| Business verification incomplete | Limits ad volume and some objectives; also blocks appeal routes | Complete business verification on the Adqonic portfolio before spending |
| Payment method mismatch | A card not matching the business is a flag | Use the business's own payment method |
| A second ad account after a restriction | The single most common path from "restricted" to "permanently banned" | **One appeal. Wait. Never create a second account or a second business portfolio.** |
| Third-party "ad account unbanning" services | They require access and frequently cause the permanent ban | Never. |
| Personal profile running the ads | Ties business risk to Ali's personal Facebook account | Ads run from the Adqonic Page inside the Adqonic business portfolio |

---

## 6. Google-specific (for when Google turns on)

- **Misrepresentation** is Google's equivalent catch-all and covers unclear
  billing, hidden costs and "unavailable offers". "First month free, then
  AED 399/month, no setup fee, no minimum term" must remain visible on the
  landing page in the same state as the ad says it. Because the price is flat and
  permanent, an ad must never imply the AED 399 is introductory or expiring —
  that is precisely an "unavailable offer".
- **Destination requirements:** the final URL must work on mobile, must not
  pop an interstitial before content, must not break the back button, and the
  domain in the display URL must match the final URL. The current landing page
  satisfies all four.
- **Trademarks:** do not put manufacturer names (Toyota, Nissan, Lexus) or
  marketplace names (Dubizzle, YallaMotor, dubicars) in ad text. They may be
  used as *keywords* in some cases but not in creative, and a complaint from a
  trademark holder disables the ad rather than the account.
- **Restricted category check:** NEXUS is B2B software. It is **not** in a
  restricted vertical and **not** a Special Ad Category on Meta (those are
  housing, employment, credit, social issues/elections). Do not, therefore,
  write copy about financing, loans or credit for dealerships — that would drag
  the account into the credit special category and restrict targeting.
- **UAE-specific:** keep creative free of alcohol, gambling, dating and
  anything culturally sensitive. Arabic-language ads occasionally take longer
  in review; launch the Arabic variants at least a day before they are needed.

---

## 7. Pre-flight compliance check (run before publishing)

- [ ] No result claim, percentage, or dirham figure attributed to NEXUS
- [ ] No testimonial, quote or named dealership
- [ ] **ALBA Cars appears nowhere** — text, image, Page name, link
- [ ] No manufacturer or marketplace trademark in any creative
- [ ] Every claim maps to: capability / question / disclosed offer fact
- [ ] The five-minute statistic is framed as market research, with no number
- [ ] Ad text and landing page say the same thing about price and about the
      product being new with no paying customers
- [ ] "Free" offers are genuinely free, with no payment method required
- [ ] Destination is the landing page — **not** a dashboard or login
- [ ] Adqonic Page furnished; business verification complete
- [ ] Account spending limit AED 600 set
- [ ] No imported or scraped phone list anywhere in the flow
