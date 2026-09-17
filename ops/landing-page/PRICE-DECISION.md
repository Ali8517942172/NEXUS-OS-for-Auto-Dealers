# NEXUS OS — The price. Decided.

**17 September 2026 · decided by Ali · supersedes every earlier pricing note in
this repository.**

**Read this file before changing a price anywhere in NEXUS.**

---

## The offer

> **AED 399 per month. Flat. Permanent. First month free.**
>
> No setup fee. No minimum term. Cancel any time.
> **No cap on the number of dealerships. No deadline. No expiring rate.**

That is the whole offer. There is nothing after the "but".

### What this is NOT

Earlier on 17 September 2026 a *capped early-access* framing was written into
several files — "founding rate", "first 10 UAE dealerships", "until 31 October
2026", "held for twelve months from your start date", `priceValidUntil`,
`eligibleQuantity`. **All of that is withdrawn.** The price itself never changed;
only the false scarcity around it, which is now removed.

Do not reintroduce a cap, a deadline, a countdown, or a "price goes up soon" line
into ad copy, the landing page, the terms, or any document here. It would be
untrue, and a claim of urgency about a limit that does not exist is a Meta
Advertising Standards problem as well as a lie (`ops/ppc/POLICY-RISK.md` §3).

### The separate offer that still exists

`commercial/PILOT-OFFER.md` prices a **hand-run managed pilot** — supervised
service, prices verified by hand, every conversation read each morning — at
**AED 5,000 setup + AED 2,500–3,500/month**. That is a different product with a
different cost base (it is dominated by Ali's hours at AED 150/hour).
**Never quote both to the same dealer.**

---

## The unit economics, corrected

The number **AED 402–512/month** appears throughout this repository as the
"per-dealer cost floor". It is real, but it is the **whole-stack cost attributed
to a single dealer** — true only when there is exactly one dealer on the
platform. `ops/ADR-002-scaling-ladder-and-when-to-pay.md` is explicit that the
GCP VM and Supabase are **shared**: one workflow set and one webhook URL serve
every dealership, the single GCP VM is rated to **200+ dealers**, and the
Supabase free tier holds to **10–30 dealers**. Those lines do not repeat per
customer.

| Item | AED/month | Fixed or marginal |
|---|---|---|
| Google Cloud VM | ~100 | **Fixed** — one box, 200+ dealers |
| Supabase | ~92 | **Fixed** — free to 10–30 dealers, then one paid project |
| AI model calls | 110–220 | **Marginal** — per dealer, per message |
| WhatsApp Cloud API | ~100 | **Marginal** — per dealer's number and volume |
| **Fixed subtotal** | **~192** | shared across all dealers |
| **Marginal, per additional dealer** | **210–320** | |

**Marginal cost of one more dealership: AED 210–320/month, against AED 399 of
revenue. Contribution margin: roughly AED 79–189 per dealer per month.**

Cost per dealer at N dealers is `192 / N + (210 … 320)`:

| N | Best case | Worst case | Against AED 399 |
|---|---|---|---|
| 1 | 402 | 512 | **−3 to −113** — loses money |
| 2 | 306 | 416 | +93 to −17 |
| 3 | 274 | 384 | **+15 to +125** |
| 4 | 258 | 368 | +31 to +141 |
| 5 | 248 | 358 | +41 to +151 |

### Break-even

- **On paid months alone:** positive at the **second** dealer in the best case,
  the **third** in the worst.
- **Including the free first month:** over a first year a dealer pays 11 of 12
  months, so effective revenue is ~**AED 366/month**. On the pessimistic marginal
  cost (AED 320), break-even moves to the **fifth** dealer —
  `192 / 5 = 38`, `38 + 320 = 358`, against `366`. **A margin of AED 8.**

**So: AED 399 is below cost at one dealer, and turns positive somewhere around
the fifth. The margin there is thin.**

### What is deliberately not in those numbers

**Ali's own hours.** `commercial/PILOT-OFFER.md` costs supervision at AED 150/hour
and it dominates every figure above. AED 399 works for a **self-serve** product
that nobody reads the messages of daily. It does not work for a supervised
service. That is the whole reason the managed pilot is a separate offer.

Also excluded: frontend hosting, domain and miscellaneous (~AED 95/month, fixed
and shared), which the AED 402–512 figure never included either. Including it
pushes break-even out by roughly one more dealer.

---

## The one thing still open

**Should the price band on stock size, message volume, or number of logins?**

**Not decided. Deliberately not decided.** Nothing here answers it and nothing
should pretend to.

The managed-pilot document bands on exactly these three (+AED 250 each above 50
vehicles, 400 inbound messages/month, or 5 logins) because each is genuine
marginal cost — and message volume in particular drives the AI and WhatsApp lines
that make up the entire AED 210–320 marginal figure above. A 400-car Sharjah
trader on a flat AED 399 is the worst customer this offer can attract, and
nothing today prevents that.

The public page says stock size is *"sized with you in the audit"* — true, and it
holds the door open without promising anything.

**This is the first thing to revisit once a real dealer signs.** Until then, the
price is flat.

---

## Where the price is stated

Changing it means changing all of these, or it contradicts itself:

- `apps/marketing-site/index.html` — hero paragraph, price card, FAQ cost answer,
  `schema.org/Offer` JSON-LD, and the meta/og/twitter descriptions in `<head>`
- `apps/marketing-site/terms.html` — "Price and term"
- `ops/ppc/AD-COPY.md`, `LAUNCH-PLAN.md`, `KILL-CRITERIA.md`, `POLICY-RISK.md`
- `ops/landing-page/AUDIT.md`, `ops/landing-page/PRICING-QUESTIONS.md`
- `commercial/PILOT-OFFER.md` — header only; its own pricing is the other offer
