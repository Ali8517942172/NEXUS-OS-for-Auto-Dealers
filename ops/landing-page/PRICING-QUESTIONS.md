# Pricing — three questions only Ali can answer

**Agent OFFER · 17 September 2026.**

This file is not "we have no price." NEXUS has a priced decision:
`commercial/PILOT-OFFER.md` v2.2, 8 September 2026 —
**AED 5,000 setup, AED 2,500–3,500/month, three-month minimum.**

The live landing page publishes a different one: **AED 399/month, no setup fee, no
minimum term, first month free, unlimited stock.** Neither document references the
other. No ADR, no note in `ops/` and no commit message in this repo explains where
AED 399 came from or that it supersedes anything. Until one of the two is withdrawn,
NEXUS has two public prices that differ by about **10×** over a first quarter
(AED 0 versus AED 12,500–15,500), and a dealer who reads the page and then receives
the pilot document will conclude, reasonably, that he is being handled.

I did not pick between them. Three questions decide it.

---

**1. Which product is on sale — the AED 399 subscription or the AED 2,500–3,500
managed pilot? They are not the same thing and cannot share a page.**
The pilot document describes a *supervised* service: prices verified by hand, every
conversation read each morning, costed at AED 150/hour of your time. AED 399 only
survives if setup is self-serve and nobody reads the messages daily — which is not
what the pilot document, or the product, does today.

**2. At AED 399 you lose money on every dealer from day one. Is that a deliberate,
budgeted acquisition cost with a stated end date, or an accident?**
Your own infrastructure table puts the per-dealer floor at **AED 402–512/month**
(GCP VM ~100, Supabase ~92, AI calls 110–220, WhatsApp Cloud ~100) before any of
your hours. AED 399 is below that. Free month one makes it worse. If the answer is
"deliberate, for the first N dealers, until D" — write N and D down, put them on the
page, and it becomes a credible early-access offer instead of a mistake. If the
answer is "accident," the number has to move before you spend on ads.

**3. Does the price scale with anything — stock, message volume, logins — or is it
genuinely flat?**
The pilot document bands on exactly these three (+AED 250 each above 50 vehicles,
400 inbound messages/month, or 5 logins) because each is real marginal cost. The
page said **"Unlimited."** A 400-car Sharjah trader on AED 399 flat is your worst
customer and will be your loudest. I have replaced "Unlimited" with *"sized with you
in the audit"*, which is true and holds the door open — but it is a holding
position, not an answer.

---

## What is now live on the page pending your answer

I removed the two things that were commitments rather than descriptions, because
both are unbackable and one is a liability:

- **Removed:** *"The first 50 UAE showrooms to come on keep AED 399 for good,
  whatever we charge later."* A lifetime price lock, below cost, offered publicly to
  fifty companies. Replaced with an early-rate line that promises **notice before
  renewal** instead of a price forever.
- **Removed:** *"Number of cars in stock — Unlimited."*
- **Unchanged:** the AED 399 headline, the free first month, "no setup fee", "no
  minimum term", and the `schema.org/Offer` JSON-LD that repeats `"price": "399"`.

Whatever you decide, it changes in **five** places or it will contradict itself
again: the hero paragraph, the price card, the FAQ answer on cost, the JSON-LD
`Offer` block, and the three meta/og/twitter descriptions in `<head>`.

---

## DECIDED — 17 September 2026, by Ali

**Question 1 — which product is on sale?** The **AED 399 founding subscription**.
The AED 2,500–3,500 managed pilot stays a separate, hand-run offer and
`commercial/PILOT-OFFER.md` now carries a header saying so. Never quote both to
the same dealer.

**Question 2 — deliberate or accident?** *Deliberate, budgeted, and capped.*
N = **10 UAE dealerships**. D = **31 October 2026**, whichever comes first.
Held for **12 months** from each dealer's start date. Both the cap and the date
are now on the public page, in the JSON-LD `priceValidUntil` and
`eligibleQuantity`, and in the FAQ answer — so the page states the loss rather
than hiding it. Maximum exposure at the floor: 10 dealers x 12 months x roughly
AED 100–115 below cost = on the order of **AED 12,000–14,000** of subsidy, plus
Ali's own hours, which are not in that number.

**Question 3 — does it scale with anything?** Not answered, and deliberately so.
The page says stock size is *"sized with you in the audit"*, which is true and
holds the door open. A 400-car Sharjah trader on a flat AED 399 is still the
worst customer this offer can attract, and nothing on the page prevents that
today. **This is the first thing to revisit once a real dealer signs.**

N and D were chosen by this session as the smallest cap that is still a real
offer, and stated here so they can be changed in one place. Everything on the
page reads from these two numbers.
