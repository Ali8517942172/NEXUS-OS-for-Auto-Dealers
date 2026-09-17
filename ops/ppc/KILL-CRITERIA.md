# NEXUS OS — Kill Criteria and Read-Outs

Date written: 2026-09-17
Applies to: `NX-UAE-AUDIT-META-PROSPECT-202609`, AED 40/day, 14 days,
AED 560 total, account spending limit AED 600.

Written **before** the spend, on purpose. A stop rule invented on day 4 while
looking at a chart is not a stop rule; it is a rationalisation.

---

## 0. The honest arithmetic, first

Before any target below means anything, here is what AED 560 actually buys.
These are **plausibility ranges from public UAE benchmarks, not forecasts** —
we have never run a campaign for this product and any number presented as a
prediction would be invented.

| Stage | Plausible range, week 1 (AED 280) |
|---|---|
| Impressions | 3,000 – 7,000 |
| Link clicks (at 0.5–1.5% CTR) | 20 – 90 |
| Landing page views (70–80% of clicks) | 15 – 70 |
| Completed audit forms (2–6% of LPVs) | **0 – 4** |

**Read that bottom row again.** The most likely week-1 outcome is between zero
and four audit requests. That is not failure — that is the resolution this
budget has. Every rule below is built around that fact.

---

## 1. What "working" looks like

### Day 3 (≈ AED 120 spent)

At this point there are 10–40 clicks. **There is no conversion signal yet and
there will not be one.** Judge delivery and creative only.

**Working:**

- Link CTR **≥ 0.9%** on at least one ad
- CPC **≤ AED 6**
- Landing-page-view rate (LPV ÷ link clicks) **≥ 70%**
- All three ads are actually delivering (impressions > 0 on each)
- Nothing rejected in ad review

**Not working, and what to change first:**

| Symptom | Diagnosis | First change |
|---|---|---|
| CTR < 0.4% | The hook is being scrolled past | Rewrite **line 1 of the primary text and swap the image**. Do not touch targeting. |
| CPC > AED 12 | Audience too narrow, or creative ignored in a competitive auction | Widen geography (add Ajman/RAK) **or** drop the narrowest interest layer — one change, not both |
| Zero impressions on an ad | In review, rejected, or budget too thin to split three ways | Check Account Quality. If clean, pause the weakest ad so two ads share AED 40 |
| LPV rate < 50% | People click and leave before the page renders | This is **not an ads problem**. Check page load on 4G and that the link is correct. Do not change copy |
| All spend on one ad | Normal. Meta concentrates | Leave it alone |

### Day 7 (AED 280 spent)

**Working — any one of these:**

- **≥ 1 completed audit form** in `public.nexus_sales_lead` with a populated
  `attribution->>'utm_campaign'`, **and that person replies on WhatsApp and is
  actually a dealer owner or GM**
- **≥ 40 landing page views** at CPC ≤ AED 6 with CTR ≥ 0.8% and no rejections

The first of those is the real one. **One right-fit dealer conversation
justifies the entire AED 560**, because the product sells at AED 399/month, flat
and permanent, first month free, no setup fee and no minimum term — a single
retained dealer returns the test cost in under two months. The price is not
capped, not time-limited and not scheduled to rise, so nothing in these criteria
may be justified by an expiring rate.

**Not working:**

| Symptom | Diagnosis | First change |
|---|---|---|
| 250+ LPVs, 0 form submits | **The offer or the page, not the ads.** The ads did their job | Stop spending. Change the above-fold ask on the landing page (shorter form? "audit" is the wrong word?) before another dirham |
| < 60 LPVs total | Delivery or creative failure | New creative concept entirely, not a tweak |
| Form submits arrive but nobody answers WhatsApp | Wrong people, or a promise the reply broke | Check who they are. Tighten the copy's self-selection line, and check the reply SLA |
| 1–2 submits, both car *buyers* | Copy is reading as consumer-facing | Add "dealership owners" / "showroom" to headline **and** line 1 |

### Day 14 (AED 560, stop-loss reached)

Three outcomes and what each means:

1. **≥ 2 right-fit dealer conversations.** The channel works. Continue at
   AED 40/day for 14 more days before changing anything. Do **not** jump the
   budget (LAUNCH-PLAN §4).
2. **1 right-fit conversation.** Ambiguous, and honestly so. n=1 tells you the
   funnel is not broken; it tells you nothing about cost per lead. Run 14 more
   days at the same budget to get a second data point. Budget a second AED 560
   or stop — do not run 3 more days and call it a trend.
3. **0 conversations.** Stop Meta. Do not "just try Google" as a reflex — read
   §3 first, because the 250-LPV/0-submit case says the problem is downstream
   of the ad and Google would buy the same zero at a higher CPC.

---

## 2. The statistics warning, stated plainly

**At this budget you cannot run an A/B test, and any dashboard that implies
you can is lying to you.**

With ~60 clicks across three ads (~20 each) and 0–4 conversions in total:

- An ad showing "5% conversion" (1 of 20) against one showing "0%" (0 of 20)
  is **not** a better ad. With one conversion, the 95% confidence interval on
  that rate runs from roughly 0.1% to 25%. The two ads are statistically
  indistinguishable and will stay that way for months at AED 40/day.
- Reaching statistical significance on a 2% vs 4% conversion-rate difference
  needs on the order of **1,500+ visitors per variant**. At 40 LPVs a week
  that is over a year.
- Day-to-day swings will look dramatic (AED 3 CPC one day, AED 11 the next)
  and are almost entirely auction noise plus a sample of fifteen clicks.

### What to look at instead

1. **CTR, not conversion rate.** CTR accumulates on impressions, and 1,000
   impressions is a usable read on whether a hook works. 1,000 impressions is
   ~0 conversions. Use the fast-moving metric to judge creative and the
   slow-moving one to judge the business.
2. **Magnitude, not significance.** Only act on differences of **3x or more**
   (CTR 1.5% vs 0.4%). A 1.1% vs 0.9% difference is noise; treating it as a
   result is how a small budget gets shredded by constant fiddling.
3. **The free text in the form.** The `message` field asks for "the one thing
   costing you most right now". Three of those sentences from real dealership
   owners are worth more than the entire click dataset — they tell you which
   angle in AD-COPY.md is the true one, and that is a question the numbers at
   this size cannot answer.
4. **Who actually replies on WhatsApp.** Owner or GM = the funnel works.
   Salesman, marketing agency, or nobody = it does not, regardless of CPC.
5. **A minimum observation window.** **Never pause an ad before 1,000
   impressions or 72 hours, whichever is later.** Every pause-and-restart
   re-enters Meta's learning phase and spends part of your remaining budget
   re-learning what it already knew.
6. **One change at a time.** With this sample size, two simultaneous changes
   make the result unattributable. One change, then 72 hours untouched.

---

## 3. The single most important diagnostic

Before concluding "ads don't work", separate the two failures, because they
have opposite fixes:

| | Landing page views | Form submits | Conclusion |
|---|---|---|---|
| A | Low (< 60) | 0 | **Ad problem.** Creative and hook. |
| B | High (250+) | 0 | **Offer/page problem.** The ads worked. Spending more is pouring money into a funnel with no exit. |
| C | High | Some, all wrong-fit | **Targeting/copy problem.** The copy is attracting car buyers or agencies. |
| D | High | Some, right-fit, none convert to demo | **Sales problem**, not a marketing one. Look at the WhatsApp reply time and what it says. |

Only case A is fixed by better ads. Cases B, C and D are fixed with the ad
account paused.

---

## 4. Weekly read-out query

Run this, not the Meta dashboard, to count what actually happened:

```sql
select date_trunc('day', received_at) as day,
       attribution->>'utm_content' as ad,
       attribution->>'utm_source'  as placement,
       count(*)                    as audits
from public.nexus_sales_lead
where attribution->>'utm_campaign' = 'NX-UAE-AUDIT-META-PROSPECT-202609'
group by 1,2,3
order by 1 desc;
```

Rows with an empty `attribution` are organic and must not be credited to the
campaign. If **every** row is empty while Meta reports clicks, the tracking
string in LAUNCH-PLAN §6 is wrong or was never pasted — stop the campaign and
fix it, because until then the spend cannot be judged at all.
