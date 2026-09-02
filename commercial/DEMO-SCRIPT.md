# NEXUS OS — Demo Script

**Version 1.0 · 2 September 2026**
**Runs in 12 minutes. Do not run long.**

Read this whole document before your first demo, including the DO NOT SHOW list. The list
has a reason beside every entry, because a salesperson who does not know *why* a screen is
off-limits will open it anyway when a buyer pushes.

---

## The one thing this demo proves

A customer messages your WhatsApp about a car. Nobody at the dealership touches it. Within
seconds they get back the right car, the right asking price, and no hint of what you paid
for it. It lands on the right customer record without creating a duplicate. You can read the
whole exchange afterwards.

That is the whole demo. It is one path. It is real, it is repeatable, and it is the only
path in this system that has been proven end to end on live traffic.

**Do not add a second story.** The temptation to show finance quoting or compliance is the
single biggest risk in this meeting. Every one of those screens is honest about being empty,
and an empty screen in a sales meeting reads as a broken product even when the emptiness is
the correct answer.

---

## Before the buyer arrives — 20 minutes of setup

1. **Load their stock, or at least six of their cars,** into the inventory table with real
   asking prices and real cost prices. The demo dies if you quote a Fortuner to a Nissan
   dealer. If you cannot get their stock, say up front that the stock on screen is a sample
   and show the ageing flags instead.
2. **Send yourself a test message on the demo number and confirm you get a reply.** Do this
   within the hour before the meeting, not the night before. The WhatsApp connection uses an
   unofficial client and it drops.
3. **Open the dashboard, sign in, and leave it on Overview.** Signing in live wastes a
   minute and can fail.
4. **Have a second phone ready** — ideally the buyer's own phone, which is far more
   convincing than yours.
5. **Check the Fortuner (or their equivalent) price is what you are going to say.** Read it
   off the Inventory screen with your own eyes.

---

## The script, beat by beat

### Beat 1 — Inventory (90 seconds). Establish the ground truth first.

**Open:** `Assets → Inventory`

**Say:**
> "Before I show you the AI, I want to show you what it is reading from. This is your stock.
> Every car has an asking price and a cost price. The Fortuner: asking AED 152,000, cost
> AED 133,000. Remember the cost number — I am going to come back to it."

Point out the ageing flags: on the sample stock, three of twelve cars carry a WARNING or
CRITICAL flag, average 56 days in stock. Say the ageing recompute runs every night at 00:15
and has run 18 times with 18 successes.

**Why this beat comes first:** if you show the reply before the price, the buyer has no way
to check it. Showing the inventory first turns the reply from a demo into a verification.

---

### Beat 2 — The message (60 seconds). Let the buyer send it.

**Say:**
> "Take your phone. Message this number and ask about one of these cars, however you would
> actually type it. Spelling mistakes are fine — that is the point."

Hand them the number. Let them type it themselves. If they will not, type it yourself but
say the words out loud as you type.

The proven example, typed exactly like this by a real person on 2 September:
> `Hi i m interested in the fortuner whats the price`

Then **stop talking and let the phone sit there.** The silence is the demo. Do not fill it.

---

### Beat 3 — The reply (30 seconds). Read it out loud.

The reply that came back on 2 September 2026 at 06:07:30, **17.8 seconds** after the
question:

> "The Toyota Fortuner 2.7 VXR 2024 we have in stock is AED 152,000. Let me know if you'd
> like more details or a test drive!"

**Say:**
> "Two things. AED 152,000 is exactly the number on the Inventory screen — it did not guess,
> it looked it up. And it did not mention AED 133,000. It knows your cost price and it will
> not say it. That is not the model being polite; it is a rule in the system."

**On timing, say this and nothing more than this:**
> "That one took 17.8 seconds. Across every automated reply since 31 August, the fastest was
> 13 seconds and the slowest was three and a half minutes — median 42 seconds. It is seconds
> to a couple of minutes, not instant. I am not going to tell you it is always 17."

**Do not promise "under 20 seconds".** You cannot hold it. The measured range is 13.3s to
219.4s across 19 replies.

---

### Beat 4 — Conversations (90 seconds). It went on the record.

**Open:** `Work → Conversations`

The exchange the buyer just sent is there — their message in, the bot's reply out, both
timestamped, marked as sent by the bot rather than by a person.

**Say:**
> "Nothing here is the AI's account of what it did. Every one of these lines is a record
> written at the time. If a salesperson tells you a customer was answered, you can check."

---

### Beat 5 — Leads (2 minutes). This is the beat that separates it from a chatbot.

**Open:** `Work → Leads`

**Say:**
> "Here is the part I actually care about. That message did not create a new customer. It
> found the customer who was already there — created two days earlier — and attached itself.
> One person, one record."

Then the harder half, and say it plainly:
> "And when it cannot tell two customers apart by phone number, it attaches the message to
> neither. It leaves it unassigned rather than guessing. A message sitting unassigned is a
> problem you can fix in ten seconds. A message filed against the wrong customer is a problem
> you find out about when the wrong person gets a call."

**A live figure you can quote:** of 108 logged messages, 47 resolve to a named customer and
the rest sit unresolved. Say that number out loud if asked. It is not a failure — most of
those are non-customer traffic on a shared number, which is exactly why a dedicated
dealership number is step one of onboarding.

---

### Beat 6 — Automation (2 minutes). The uncomfortable screen, shown on purpose.

**Open:** `Operations → Automation`

This screen shows 18 workflows and their health. Right now: **2 healthy, 11 degraded, 1
producing nothing, 1 never run, 3 not instrumented.**

**Show it anyway. Say this:**
> "I could have kept you off this screen. Here is why I am not. The system grades its own
> workflows and it grades them harshly — one failure in thirty days and a workflow goes
> amber. The WhatsApp agent shows 42% over thirty days, because most of that month was me
> building it. Since 28 August it has run 47 times with 40 successes. I am showing you the
> bad number and the good number, because you are going to see this screen in week one either
> way and I would rather you hear it from me."

Then point at the competitor scraper, marked "producing nothing":
> "That one finds a usable price on 14 attempts out of 120. The system says so itself, in
> those words. It is not in your pilot and I am not charging you for it."

**Why this beat exists:** it is the trust beat. A buyer who has just watched you volunteer
your worst screen will believe your best one. Skipping it is the short-term play.

---

### Beat 7 — Close (2 minutes). No screen.

Shut the laptop.

**Say:**
> "What you saw is one path, and it is the only path I will sell you today: a WhatsApp
> message becomes an answered customer with a correct price, on the record, in seconds.
> Everything else in this system is built and unproven, and I have written down which is
> which — I will send you that document, not a brochure.
>
> Three months. AED 3,500 a month plus AED 5,000 to set it up. One dealership, one number,
> running on my infrastructure with me watching it every day. If it is not working by day
> 30, you tell me and we stop."

Hand over `PILOT-OFFER.md` and `WHAT-WE-CLAIM.md`. Handing over the claims register is the
strongest move in this meeting. Do it.

---

## DO NOT SHOW — and the reason for each

Every reason below is a fact from the live system on 2 September 2026. Read the reasons, not
just the list.

| Screen | Why it stays shut |
|---|---|
| **Intelligence → Finance Desk** | The quotes table holds **zero rows**. The screen is honest and will render as empty, which looks broken. Worse: on 31 August an earlier build quoted a real person a monthly payment of **AED 11,200** when the true figure was nearer **AED 7,800**, and sent it. That is a number a dealership could be held to. The path is gated off and stays off. |
| **Work → Compliance** | The KYC register holds **3 rows and zero verified customers** — all three submissions were correctly rejected as "not an identity document". The auditor workflow has 9 logged runs, 7 failures, 0 successes. A buyer who sees a compliance screen assumes compliance. You have none to sell. |
| **Operations → Deals** | The sales table holds **zero rows**. No deal has ever been recorded through this system. An empty pipeline screen in a sales meeting is the worst possible frame. |
| **Assets → Competitors** | 14 usable prices out of 120 attempts. The system classifies it as "producing nothing" in those words. Do not open a screen that argues against you. |
| **Operations → Campaigns** | The drip campaign has run 5 times and failed 5 times. 0% success. |
| **Operations → Team** | There is **one user** in the system. A team screen showing one person undercuts everything you just said about a dealership floor. |
| **Settings** | It exposes integration configuration and connection state. It is an engineering screen and it invites engineering questions you do not want in a sales meeting. |
| **Intelligence → Ask AI** | *Judgement call.* It works — 11 successes in 14 runs, graded healthy — but it has not run since **24 August** and there are only 15 documents loaded. Show it only if the buyer asks about "AI answering staff questions", and say clearly it is loaded with sample documents, not theirs. |
| **Intelligence → Customer 360** | Holds **2 profiles** and refreshes once daily as a batch. If you show it, do not describe it as live. It is a nightly job. |
| **Overview — the Pipeline value tile** | With the current data it correctly reports that no open lead has a budget recorded. That is the right answer and it looks like a bug. Overview is the landing screen so the buyer will see it; steer to Inventory within fifteen seconds and do not narrate the tiles. |

---

## The three questions that will be asked, and the honest answers

### "Can it work out the monthly payment for the customer?"

> "No, and I am not going to let it. The finance calculator has run 62 times and written
> zero quotes. Its last recorded success was 24 August. On 31 August it quoted a real person
> AED 11,200 a month when the right answer was closer to AED 7,800 — and it sent it. I
> switched that path off and it stays off for your pilot.
>
> What it does instead is hand the conversation to your finance person with the customer's
> question and the car attached. That is the honest version, and it is the version that
> cannot get you a complaint from a customer holding a screenshot."

**Never soften this into "finance is coming soon".** If they need finance quoting, that is a
real reason not to buy yet, and telling them so is what gets you the call back in three
months.

### "Does it verify ID? We have compliance obligations."

> "No. Three documents have gone through the KYC path and all three were correctly rejected
> as not being identity documents. Zero have ever been successfully verified. I will not sell
> you a compliance tool I have never seen succeed.
>
> What the system does do is refuse to show a customer as compliant when it does not know.
> An unchecked customer shows as unknown, not as clear. That is deliberate — a compliance
> screen that reports 'no problems found' when the checker itself failed is worse than no
> screen at all."

### "How many dealerships are using this?"

> "None. You would be the first, and that is why it is a supervised pilot at pilot money and
> not a subscription at software money. I run it, I watch it daily, and there is only one
> dealership on the system — because the database does not yet separate one dealership's data
> from another's. That is the next thing I build, and until it is built I physically cannot
> put a second customer on the same instance. I would rather tell you that than have you find
> out when a competitor of yours signs up."

---

## Hard rules for whoever gives this demo

1. **Never quote a monthly payment, APR or EMI.** Not verbally, not "roughly", not
   "indicative". The system has produced a wrong one and sent it to a real person.
2. **Never say "real time".** Say "seconds to a couple of minutes". The measured range is
   13.3s to 219.4s.
3. **Never say "enterprise", "compliant", "SOC 2", "multi-tenant" or "99.9%".** None is true.
   Note that the repository's own README describes a multi-tenant architecture — that
   describes an intention, not the database. Do not read from it.
4. **Never show a second dealership's data, or claim you could.** You cannot; every access
   policy in the database is unrestricted.
5. **If the live demo fails, do not fake it.** Say: "That is the unofficial WhatsApp client
   dropping — it is exactly why moving to the official API is week one of your onboarding."
   Then walk the Conversations screen showing the 2 September exchange that did work. A
   recovered failure demonstrates the honesty you have been claiming for ten minutes.
6. **If you do not know, say you will check and then actually check.** Every figure in this
   pack came from a query against the live database. You can always get the real answer.
