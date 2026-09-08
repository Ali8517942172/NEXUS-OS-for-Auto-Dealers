# NEXUS OS — Managed AI Dealership Pilot

**Version 2.1 · 3 September 2026 · Ali Asgher**
**Every figure re-verified against the live database on 3 September 2026**, scoped to the one
real dealership on the system. Where a count has moved since the 2 September version it has
been corrected here rather than left standing.

This is a managed pilot, not an enterprise software subscription. Where something has not
been proven, this document says so. Nothing here is a projection dressed up as a fact.

**What changed since version 1.0**, so you are not comparing two documents: the price moved
from a flat monthly fee to a setup fee plus a monthly band; the 17.8-second response-time
claim has been **withdrawn in full** and replaced with a measured range and no promise; and
database-level separation between dealerships landed this morning and is described below at
exactly the level it has been tested.

---

## What this is

One dealership. One WhatsApp number. A three-month supervised pilot.

When a customer messages your WhatsApp number about a car, NEXUS OS reads the message,
works out which customer it is, looks up the car in your live stock list, and answers
them — with your real asking price and without ever revealing what you paid for the car.
It logs the whole exchange so you can read it back.

You watch it work on your own stock, with your own customers, for three months. Then you
decide whether it is worth keeping.

It runs on my infrastructure, under my supervision, and I am in it every day. That is the
honest description and it is also the reason it works — a system this young needs someone
watching it. You are buying a managed service with me attached, not a licence to software.

**What you are joining.** NEXUS is being built as a product for auto dealerships — the UAE
first, then wider — not as a bespoke system for any one dealer. One dealership is on it
today, and it is the pilot. That is a statement about where the product is going. It is not a
claim that NEXUS runs several dealerships side by side, because it does not yet, and nothing
in this document should be read as saying otherwise.

---

## What the dealership gets

**1. Automatic first reply on WhatsApp**

> **Nexus automatically responds to inbound dealership enquiries and routes high-intent
> opportunities to the right team.**

Every inbound WhatsApp message gets answered without a salesperson touching it. The reply
is grounded in your actual stock list — it quotes the price that is in your inventory
table, not a price the AI invented.

Proven on 2 September 2026: a customer asked *"Hi i m interested in the fortuner whats the
price"* and got back *"The Toyota Fortuner 2.7 VXR 2024 we have in stock is AED 152,000."*
AED 152,000 is exactly the asking price on that VIN in the inventory table. The cost price
of AED 133,000 was not mentioned. The run logged a SUCCESS record with all three of its
claimed steps independently verified.

**On how fast: I am not selling you a response time.** I do not have enough data to promise
one. Across all 18 automated replies the system has ever sent, measured this morning: fastest
13 seconds, median 39 seconds, slowest 3 minutes 38 seconds. Four of the eighteen took over
100 seconds. The honest sentence is *"seconds to a couple of minutes"*. When there is enough
production traffic to state a real figure, I will state it and put the measurement in
writing. Not before.

**2. One customer, one record**
The 2 September message attached itself to a customer record created two days earlier. It
did not create a duplicate. If two customers cannot be told apart by their phone number, the
system attaches the message to neither rather than guessing — an unanswered message is a
smaller problem than a message shown to the wrong customer.

**3. A live dashboard**
Fourteen screens over one database: leads, conversations, inventory, ageing stock, workflow
health, and an Ask-AI box that answers questions from your own documents. You see what the
bot said, when, and to whom.

**4. Ageing stock, computed nightly**
Days-in-stock is recomputed every night at 00:15 and flags cars that are sitting too long.
On the current 12-unit demo stock, three cars carry an ageing flag (2 WARNING, 1 CRITICAL),
average 57.4 days and rising by one a night. This job has run 20 times with 20 successes — it
is the most reliable thing in the system.

**5. Your data is separated in the database from any other dealership's**
This landed on 2 September 2026 and it is new. Every table that holds your data carries a
dealership id, and every access rule in the database checks it: a signed-in user reads only
their own dealership's rows. It was tested that morning with two test dealerships, and
re-tested harder on 3 September across every table and every view in the database, including
with the same customer email and the same phone number deliberately planted in both
dealerships. Each saw its own rows and none of the other's; attempts to write across the line,
or to forge the dealership id inside a login token, were refused by the database.

**Read the limit as carefully as the claim.** The database layer is most of the way, not
finished, and the automation layer is not started. Three things are outstanding, and none of
them can happen while there is one dealership on the system:

- the workflows that write your messages into the database still run as a system account with
  no dealership attached, so a second dealership's traffic would file under the first;
- uploaded ID documents that lose their database record fall through to whichever dealership
  is set as the default;
- two of the reports go silently empty, rather than wrong, the moment a second dealership
  exists.

Until all three are fixed I sell **one dealership per system**. I am telling you the shape of
the gap rather than selling you the word "multi-tenant".

**6. Me**
Daily supervision. I read what the bot said. I fix it when it is wrong. You get me on
WhatsApp during UAE business hours.

---

## What is explicitly NOT included

I would rather you read this now than discover it in month two. Every figure below was
checked this morning.

| Not included | Why |
|---|---|
| **Finance quoting** — monthly payment, APR, EMI | The finance calculator has run 65 times and written **zero** quote records. Its last recorded success was 24 August. On 31 August an earlier version quoted a real person a monthly payment of AED 11,200 when the true figure was nearer AED 7,800. That path is switched off and stays off during the pilot. |
| **KYC / ID verification** | Three documents have been submitted through it. All three were correctly rejected as "not an identity document". **Zero documents have ever been successfully verified.** The auditor workflow has 12 logged runs, 10 failures and 0 successes; the last genuine run was 17 August. Rows appearing in the register is not the same as the capability working. |
| **Closed-deal / sold reporting** | `purchase_history` held **zero rows** all the way to 09:59 on 2 September 2026. At **09:59:53** the first row appeared, written by repair work going on that morning: the owner's own test lead (lead 38, still marked WARM), a Lexus LX 600 2024 at AED 585,000. **It is not a customer sale.** No dealership customer has ever bought a car through this system. The sync job now shows 19 runs, 15 failures, 4 successes and is still graded DEGRADED. One row from a repair test is not a working capability — check the outcome, never the count. |
| **Competitor price tracking** | It runs nightly and finds a usable price on 17 of 168 attempts. It is classified by the system's own health rules as "producing nothing". Not sold, not shown. |
| **A second dealership on this system** | The database separates dealerships and that is tested (see point 5 above), but it is not finished and the automation has not started. One dealership only, and that is a hard limit. |
| **Per-role permissions** | Everyone you give a login to sees every lead, every customer, every message and every cost price. **And it is not a read-only login:** anyone signed in can also change a car's asking price and cost price, delete a vehicle record outright, and reassign any lead. Nothing in the system stops them — there is no junior-salesperson view and no approval step on those two screens. Give logins only to people you would trust with the stock file itself. |
| **Service history, service reminders, no-show recovery, trade-in valuation, deal-stage rescue, finance across multiple banks, benchmarking against other dealerships** | None of these is built. There is no service table, no appointments table and no connection to a DMS in this system, so they are not "switched off", they do not exist. They are on the roadmap and they are not in this price. If one of them is what you actually need, that is a good reason not to buy this yet. |
| **Anything about the automation being locked down** | The inbound WhatsApp webhook does not yet check a secret — the check is written but not switched on. A second control refuses requests that do not name a known WhatsApp session, and that is what is holding the door today. Switching the secret on is a configuration change on the server and it is part of week one, before your customers touch it. I would rather you saw this in writing now. |
| **An uptime SLA or support ticketing** | There is none. There is me, on WhatsApp, in UAE hours. The infrastructure health probe is registered and has never run. |
| **Automatic data retention / purging** | The retention purge workflow is registered, is marked active, and has **never run once**. Deletion during the pilot is manual and on request. |
| **A signed data-processing agreement** | Not drafted. If your legal team needs one before customer data moves, say so now and we build that into week one. |
| **Any channel other than WhatsApp** | Facebook, Instagram, website forms and TikTok are wired and have never carried a single lead. They are an afternoon of configuration each, and they are not part of this price. |

---

## Price

### **Setup: AED 5,000, one time. Monthly: AED 2,500 to AED 3,500. Three-month minimum.**

Invoiced monthly in advance. Setup invoiced on signature. The three months run from the day
the first real customer message is answered, not from the day you sign.

**Quarter one, all in: AED 12,500 at the bottom of the band, AED 15,500 at the top.**

### Why a band and not one number

Because I have not sold this to anyone yet. No external customer, no finance capability, no
proven KYC, no closed deal in the system and no production support history. A single firm
price would imply a firmness the product does not have. The band is not there so I can
haggle — it is there because a 12-car showroom with two staff and a 150-car operation with
nine are genuinely different amounts of my time.

### The rule that decides where you land

**Start at AED 2,500. Four things each add AED 250. The maximum is AED 3,500.**

| Add AED 250 if… | Why it costs me more |
|---|---|
| Your stock is **more than 50 vehicles** | More cars to load, more prices to verify by hand, more re-verification every time stock turns. A wrong price is the fastest way to lose a pilot, so every price is checked manually. |
| You take **more than 400 inbound customer messages a month** | Every message is model calls I pay for, and more conversations for me to read every morning. |
| **More than 5 people** need a dashboard login | Each login is setup, plus questions, plus the cost-price conversation, since there are no per-role permissions. |
| **I run the WhatsApp number for you** — the Meta Business account, the verification, the templates, and Meta's per-message fees billed through me | Otherwise you hold the Meta account, the message fees are yours, and I only connect to it. |

Worked examples:

- 30 cars, 3 staff, ~200 messages a month, you own the Meta account → **AED 2,500**
- 70 cars, 4 staff, ~300 messages, I run the number → **AED 3,000**
- 120 cars, 8 staff, ~600 messages, I run the number → **AED 3,500**

**Three rules around the rule, so it stays a pricing model and not a negotiation:**

1. **The band is measured from your actual data, not your estimate.** We set the price at
   signature from your inventory file and your own message-volume figures, and it is fixed
   for the three months. If you cross a line in month two, nothing changes until renewal.
2. **There is no price below AED 2,500.** See the cost working below. Under that I am working
   for nothing, and you are buying an owner who resents the account.
3. **Above the band is a separate quote.** More than 200 vehicles, more than 1,500 messages a
   month, or more than one branch is not this offer. A second branch in particular needs the
   workflow-level separation described above, which does not exist yet.

### What it costs me to run one dealership

**Infrastructure, per month, once the free tiers end:**

| Item | Monthly (AED) | Note |
|---|---|---|
| Google Cloud VM | ~100 | Currently on the Always Free e2-micro. It is CPU-starved and has fallen over twice. For a paying customer it moves to a paid instance. |
| Supabase | ~92 | Free tier pauses after inactivity and takes no daily backups. Commercial use needs the paid tier. |
| AI model calls | 110–220 | Currently on OpenRouter and Groq free tiers, rate-limited with no availability guarantee — which is exactly why the system carries a fallback model ladder. A paying customer gets paid capacity. |
| WhatsApp Cloud API | ~100 | Once migrated off the unofficial client. Service replies inside the 24-hour window are free; utility and marketing messages are charged per message. |
| Frontend hosting, domain, misc | ~95 | |
| **Infrastructure subtotal** | **~500–600** | |

**And the cost that actually dominates: my hours.** A supervised pilot means reading what the
bot said every day, refreshing stock until an automatic feed exists, and responding when a
workflow breaks. It breaks. The WhatsApp workflow shows 290 runs and 166 failures over thirty
days — 42%. The recent picture is much better, 40 successes out of 47 runs since 28 August,
but "much better" is not "unattended".

Costed at **AED 150 an hour**:

| | Hours | Supervision (AED) | Infrastructure (AED) | **Total (AED)** |
|---|---|---|---|---|
| Month 1 | 8–15 | 1,200–2,250 | 500–600 | **1,700–2,850** |
| Months 2 and 3, each | 4–6 | 600–900 | 500–600 | **1,100–1,500** |
| Onboarding, one time (3–5 working days) | 24–40 | 3,600–6,000 | — | **3,600–6,000** |

### Does AED 2,500 still cover cost? Honestly: only just.

**Over the three-month minimum, at the bottom of the band:**

- Revenue: AED 5,000 setup + 3 × AED 2,500 = **AED 12,500**
- Cost, best case: 3,600 + 1,700 + 1,100 + 1,100 = **AED 7,500** → margin **AED 5,000**
- Cost, worst case: 6,000 + 2,850 + 1,500 + 1,500 = **AED 11,850** → margin **AED 650**

**So the floor holds, but barely.** AED 2,500 clears cost by AED 5,000 over the quarter if
onboarding runs to five days and month one behaves. If onboarding overruns, or the WhatsApp
workflow has a bad month, the same quarter clears cost by about AED 650 — that is
break-even, not a margin.

**What that means in practice.** AED 2,500 is the price for the smallest, simplest
dealership: under 50 cars, under 400 messages, five or fewer logins, holding its own Meta
account. It is not the default and it is not a discount. **The setup fee is not optional at
that price**, because the setup fee is what pays for the onboarding week — remove it and the
floor loses money outright.

At the top of the band the same quarter is AED 15,500 against AED 7,500–11,850 of cost. That
is a real margin, and it should be, because that is the dealership that will take real hours.

### What the dealership stands to gain

On the live inventory of 12 units, the average gross margin per car is **AED 31,658**
(AED 3,046,900 total asking price against AED 2,667,000 total cost).

**That is asking price minus purchase cost, and nothing else.** It is before reconditioning,
VAT, commission and the cost of the car sitting on the lot. The system does not hold a
reconditioning cost for a single one of those twelve units, so it cannot compute a net margin
and it says "not computable" rather than showing you a number — which is the behaviour you
should want from it, and it is also why the figure above is the top of the range, not the
money you keep.

The pilot costs AED 12,500 to AED 15,500 for the quarter. **That is 40% to 49% of the gross
margin on one car**, and a larger share of the net.

I am not going to promise you a recovered deal, and nothing in this document is a projection
of one. There are 3 leads in the system and none is a completed customer sale. What I can show
you is the mechanism: a customer asked a price question at six in the morning and got a
correct, grounded answer with no human awake. Whether that converts is exactly what the pilot
is for, and it is the thing neither of us knows yet.

### The setup fee

AED 5,000, one time, invoiced on signature. It covers three to five working days of work that
happens whether or not you renew: separating the WhatsApp number, loading your stock,
migrating to the official WhatsApp API, configuring your staff and hours, and tuning the
bot's answers against your actual conversations. `PILOT-ONBOARDING.md` sets out exactly what
those days contain. At AED 150 an hour that work is worth AED 3,600–6,000, so the setup fee
is close to cost, not a margin line.

---

## Term and what happens at the end

**Three months, from the day the first real customer message is answered** — not from the
day of signature. Onboarding time is mine, not yours.

**Month one is a get-out month.** If it is not working by day 30, tell me and we stop. You
pay for month one and the setup, nothing further. I would rather end a pilot cleanly than
argue about month three.

**At the end of the three months, one of four things happens:**

1. **You continue.** We agree a production price, which will be higher, and I tell you in
   writing what changed to justify it — realistically: the official WhatsApp API in
   production, dealership-aware automation, and a monitored uptime commitment.
2. **You extend the pilot** at the same price while something specific gets built — most
   likely finance quoting, which is the feature buyers ask for first and the one I cannot
   sell today.
3. **You stop.** Your data is exported to you as CSV within five working days and deleted
   from my systems within thirty. The WhatsApp number is handed back to you. Nothing is held
   hostage.
4. **I stop it.** If the system is putting wrong information in front of your customers and I
   cannot fix it, I will end the pilot myself and refund the unused month. That clause is here
   because it is the one that should make you trust the rest.

**Your data is yours throughout.** Stock, customers, and conversation history export to CSV
on request, at any point, without notice.

---

## What I need from you to start

Inventory list, a WhatsApp number that has never been used personally, a list of who works
there and who covers what, and your working hours. Detail and timings are in
`PILOT-ONBOARDING.md`. Realistically **three to five working days** of my time, spread over
one to three calendar weeks — the spread is Meta's business verification, not my speed.

---

## The two things to read twice

**1. The system today runs on an unofficial WhatsApp client on a personal number.** It works
— everything proven above went through it — but it is against WhatsApp's terms of service and
the number can be banned without warning. It must move to the official WhatsApp Cloud API
before your customers ever touch it. That migration is week one and the pilot does not go live
on real customers until it is done.

**2. That personal number means the database currently holds conversations that have nothing
to do with any dealership** — a contracting company, a perfumer, family, cheque and payment
discussions. Twelve WhatsApp contacts are on file and one of them is a car enquiry. That is
unacceptable for a commercial deployment, it is why step one of your onboarding is a dedicated
number, and it is why those existing conversations are deleted before your first customer
message arrives. I am telling you this before you sign rather than after, because you would
find out either way.

---

## Figures in this document, and when they were checked

Checked against Supabase project `dsvuoovivysszdoiorch` on **3 September 2026**, scoped to the
one real dealership.

| Figure | Value |
|---|---|
| Real customer sales recorded | **0** (1 row exists, written 09:59:53 on 2 Sep by a repair test against the owner's own lead) |
| Finance quotes produced | **0** |
| ID documents successfully verified | **0** (3 submitted, all 3 correctly rejected) |
| Customer records | **3** (2 are disqualified wrong numbers) |
| Vehicles in stock | **12** — AED 3,046,900 asking, AED 2,667,000 cost, **0 with a reconditioning cost recorded** |
| Messages on record | **108** — 83 inbound WhatsApp, 18 automated replies, 5 sent by hand, 2 system |
| Automated replies: fastest / median / slowest | **13.3s / 38.8s / 218.3s** across 18 replies, all sent between 31 Aug and 2 Sep |
| Run records written | **687** |
| Dealerships on the system | **1** |
| Dashboard logins | **1** |

If you are reading this more than a week after the date above, ask me to re-run it. I will,
and I will send you the result whichever way it has gone.
