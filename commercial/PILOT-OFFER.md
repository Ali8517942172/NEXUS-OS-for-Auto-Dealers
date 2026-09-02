# NEXUS OS — Dealership Pilot Offer

**Version 1.0 · 2 September 2026 · Ali Asgher**

Every number in this document was measured against the live system on 2 September 2026.
Where something has not been proven, this document says so. Nothing here is a projection
dressed up as a fact.

---

## What this is

One dealership. One WhatsApp number. A three-month supervised pilot.

When a customer messages your WhatsApp number about a car, NEXUS OS reads the message,
works out which customer it is, looks up the car in your live stock list, and answers
them — with your real asking price and without ever revealing what you paid for the car.
It logs the whole exchange so you can read it back.

You watch it work on your own stock, with your own customers, for three months. Then you
decide whether it is worth keeping.

This is a pilot, not a software subscription. It runs on my infrastructure, under my
supervision, and I am in it every day. That is the honest description and it is also the
reason it works — a system this young needs someone watching it.

---

## What the dealership gets

**1. Automatic first reply on WhatsApp**
Every inbound WhatsApp message gets answered without a salesperson touching it. The reply
is grounded in your actual stock list — it quotes the price that is in your inventory
table, not a price the AI invented.

Proven on 2 September 2026: a customer asked *"Hi i m interested in the fortuner whats the
price"* at 06:07:12. The system replied at 06:07:30 — **17.8 seconds** — with
*"The Toyota Fortuner 2.7 VXR 2024 we have in stock is AED 152,000."* AED 152,000 is
exactly the asking price on that VIN in the inventory table. The cost price of AED 133,000
was not mentioned. The run logged a SUCCESS record with all three of its claimed steps
independently verified.

**2. One customer, one record**
The same message attached itself to a customer record created two days earlier. It did not
create a duplicate. If two customers cannot be told apart by their phone number, the system
attaches the message to neither rather than guessing — an unanswered message is a smaller
problem than a message shown to the wrong customer.

**3. A live dashboard**
Fourteen screens over one database: leads, conversations, inventory, ageing stock, workflow
health, and an Ask-AI box that answers questions from your own documents. You see what the
bot said, when, and to whom.

**4. Ageing stock, computed nightly**
Days-in-stock is recomputed every night at 00:15 and flags cars that are sitting too long.
On the current 12-unit demo stock, three cars carry a WARNING or CRITICAL ageing flag. This
job has run 18 times with 18 successes — it is the most reliable thing in the system.

**5. Me**
Daily supervision. I read what the bot said. I fix it when it is wrong. You get me on
WhatsApp during UAE business hours.

---

## What is explicitly NOT included

I would rather you read this now than discover it in month two.

| Not included | Why |
|---|---|
| **Finance quoting** — monthly payment, APR, EMI | The finance calculator has run 62 times and written **zero** quote records. Its last recorded success was 24 August. On 31 August an earlier version quoted a real person a monthly payment of AED 11,200 when the true figure was nearer AED 7,800. That path is switched off and stays off during the pilot. |
| **KYC / ID verification** | Three documents have been submitted through it. All three were correctly rejected as "not an identity document". **Zero documents have ever been successfully verified.** The register is empty of verified customers, and an empty register is not a clean compliance result. |
| **Closed-deal / sold reporting** | The sales table holds **zero rows**. No sale has ever been recorded through this system. The wiring exists and has never carried a deal. |
| **Competitor price tracking** | It runs nightly and finds a usable price on 14 of 120 attempts. It is currently classified by the system's own health rules as "producing nothing". Not sold, not shown. |
| **A second dealership** | The database has no tenant separation. Any signed-in user can read every record. Putting a second dealership on this instance would let each read the other's customers. One dealership only, and that is a hard limit, not a soft one. |
| **An uptime SLA or support ticketing** | There is none. There is me, on WhatsApp, in UAE hours. |
| **A signed data-processing agreement** | Not drafted. If your legal team needs one before customer data moves, say so now and we build that into week one. |
| **Any channel other than WhatsApp** | Facebook, Instagram, website forms and TikTok are wired and have never carried a single lead. They are an afternoon of configuration each, and they are not part of this price. |

---

## Price

### Recommended: **AED 3,500 per month, three-month minimum, plus AED 5,000 one-time setup.**

**First quarter total: AED 15,500.** Invoiced monthly in advance. Setup invoiced on day one.

### Why this number, and not AED 2,000 or AED 5,000

**What it costs me to run one dealership, per month:**

| Item | Monthly (AED) | Note |
|---|---|---|
| Google Cloud VM | ~100 | Currently on the Always Free e2-micro. It is CPU-starved and has fallen over twice. For a paying customer it moves to a paid instance. |
| Supabase | ~92 | Free tier pauses after inactivity and takes no daily backups. Commercial use needs the paid tier. |
| AI model calls | 110–220 | Currently on OpenRouter and Groq free tiers. Free tiers are rate-limited with no availability guarantee — that is exactly why the system carries a fallback model ladder. A paying customer gets paid capacity. |
| WhatsApp Cloud API | ~100 | Once migrated off the unofficial client. Service replies inside the 24-hour window are free; utility and marketing messages are charged per message. |
| Frontend hosting, domain, misc | ~95 | |
| **Infrastructure subtotal** | **~500–600** | |

**And the cost that actually dominates:** my time. A supervised pilot means reading what the
bot said every day, refreshing stock until an automatic feed exists, and responding when a
workflow breaks. It breaks. In the last 30 days the WhatsApp workflow logged 290 runs, 166
of which the system classified as failures. Most of those were during development and the
recent picture is far better — 40 successes out of 47 runs since 28 August — but "far
better" is not "unattended".

Honest estimate: **8–15 hours in month one, 4–6 hours a month after that.** At any sane
value on my time that is AED 1,200–2,250 a month.

**True cost to run: roughly AED 1,700–2,850 a month.**

So **AED 2,000 is below cost.** It does not cover the supervision that makes the pilot safe,
and a price that low tells the buyer the product is worth nothing. It also traps you: you
cannot raise a customer from AED 2,000 to a production price later without it reading as a
bait-and-switch.

**AED 5,000 buys expectations you cannot meet.** At AED 5,000 a month a dealership expects
finance quoting, deal reporting and a support SLA. You have none of the three. Charging for
the expectation is how a pilot turns into a refund.

**AED 3,500 covers cost with a real margin, and it is defensible out loud:** it is roughly
what a dealership spends on two hours of one salesperson's day. The salesperson goes home at
night. This does not.

### What the dealership stands to gain

On the live inventory of 12 units, the average gross margin per car is **AED 31,658**
(AED 3,046,900 total asking price against AED 2,667,000 total cost).

The pilot costs AED 15,500 for the quarter. **That is 49% of the gross margin on one car.**
If the system recovers one deal in three months that would otherwise have been lost to a
slow reply, it has paid for itself twice over.

I am not going to promise you that deal. I have three leads in the system and none of them
is a completed sale. What I can show you is the mechanism: a customer asked a price
question and got a correct, grounded answer in 17.8 seconds, at six in the morning, with no
human awake. Whether that converts is what the pilot is for.

### The setup fee

AED 5,000, one time, invoiced on signature. It covers three to five working days of work
that happens whether or not you renew: loading your stock, migrating the WhatsApp number,
configuring your staff and hours, and tuning the bot's answers against your actual
conversations. `PILOT-ONBOARDING.md` sets out exactly what those days contain.

---

## Term and what happens at the end

**Three months, from the day the first real customer message is answered** — not from the
day of signature. Onboarding time is mine, not yours.

**Month one is a get-out month.** If it is not working by day 30, tell me and we stop. You
pay for month one and the setup, nothing further. I would rather end a pilot cleanly than
argue about month three.

**At the end of the three months, one of four things happens:**

1. **You continue.** We agree a production price, which will be higher, and I tell you in
   writing what changed to justify it — realistically: the official WhatsApp API, proper
   tenant separation, and a monitored uptime commitment.
2. **You extend the pilot** at the same price while something specific gets built — most
   likely finance quoting, which is the single feature buyers ask for first and the one I
   cannot sell today.
3. **You stop.** Your data is exported to you as CSV within five working days and deleted
   from my systems within thirty. The WhatsApp number is handed back to you. Nothing is held
   hostage.
4. **I stop it.** If the system is putting wrong information in front of your customers and
   I cannot fix it, I will end the pilot myself and refund the unused month. That clause is
   here because it is the one that should make you trust the rest.

**Your data is yours throughout.** Stock, customers, and conversation history export to CSV
on request, at any point, without notice.

---

## What I need from you to start

Inventory list, the WhatsApp number, a list of who works there and who covers what, and your
working hours. Detail and timings are in `PILOT-ONBOARDING.md`. Realistically **three to
five working days** from receiving the inventory file to the first live customer reply.

---

## The one thing to read twice

The system today runs on an **unofficial WhatsApp client on a personal number**. It works —
everything proven above went through it — but it is against WhatsApp's terms of service and
the number can be banned without warning. **It must move to the official WhatsApp Cloud API
before your customers ever touch it.** That migration is scheduled in week one of onboarding
and the pilot does not go live on real customers until it is done. I am telling you this
before you sign rather than after, because you would find out either way.
